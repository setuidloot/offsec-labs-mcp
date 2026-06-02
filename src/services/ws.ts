/**
 * WebSocket-based discovery of running lab instances.
 *
 * The OffSec portal does NOT expose the running instance id or target IP over
 * REST — they're only delivered over its events WebSocket. This module
 * reproduces the portal's handshake to read them with the bearer token alone
 * (no cookie required):
 *
 *   1. Connect to wss://portal.offsec.com/ws/events (the upgrade is unauthenticated).
 *   2. Send {action:"sign_in", value:<bearer token>}  -> server replies group:"auth".
 *   3. Send {action:"subscribe", value:"host_actions"} -> server replies group:"system"
 *      and then immediately pushes a group:"host_actions"/"started" SNAPSHOT listing
 *      every currently-running instance (id, ip, related_host:{id,name}, state).
 *
 * We collect those messages for a short window, parse them, and return the live
 * instances. Authentication uses the token via the sign_in message, so a
 * cookie-only configuration cannot drive this (a bearer token is required).
 */

import WebSocket from "ws";

import { WS_DISCOVERY_TIMEOUT } from "../constants.js";
import { loadRuntimeConfig, MissingCredentialsError } from "./client.js";
import { parseRunningInstances } from "./normalize.js";
import { RunningInstance } from "../types.js";

function userAgent(): string {
  return (
    process.env.OFFSEC_USER_AGENT ||
    "Mozilla/5.0 (compatible; offsec-mcp-server/2.0)"
  );
}

/**
 * Connect, authenticate, subscribe to host_actions, and return the running
 * instances reported in the snapshot. Resolves to [] if nothing is running.
 */
export function getRunningInstances(
  timeoutMs: number = WS_DISCOVERY_TIMEOUT
): Promise<RunningInstance[]> {
  const token = process.env.OFFSEC_BEARER_TOKEN?.trim();
  if (!token) {
    // sign_in authenticates with the bearer token; a cookie can't substitute here.
    return Promise.reject(
      new MissingCredentialsError(
        "OFFSEC_BEARER_TOKEN is required to discover running instances over the " +
          "WebSocket (the sign_in handshake authenticates with the token)."
      )
    );
  }

  return new Promise<RunningInstance[]>((resolve, reject) => {
    let settled = false;
    const messages: unknown[] = [];
    let ws: WebSocket;
    let hardTimer: NodeJS.Timeout;
    let settleTimer: NodeJS.Timeout | undefined;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      if (settleTimer) clearTimeout(settleTimer);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      if (err) reject(err);
      else resolve(parseRunningInstances(messages));
    };

    // Once the snapshot starts arriving, wait a brief settle window for any
    // follow-up events, then resolve.
    const scheduleSettle = (ms = 1200) => {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => finish(), ms);
    };

    loadRuntimeConfig()
      .then(({ wsUrl }) => {
        ws = new WebSocket(wsUrl, {
          headers: { Origin: "https://portal.offsec.com", "User-Agent": userAgent() },
        });

        hardTimer = setTimeout(() => finish(), timeoutMs);

        ws.on("open", () => {
          ws.send(JSON.stringify({ action: "sign_in", value: token, extra: {} }));
        });

        ws.on("message", (data: WebSocket.RawData) => {
          let msg: any;
          try {
            msg = JSON.parse(data.toString());
          } catch {
            return;
          }
          messages.push(msg);

          if (msg?.group === "auth" && msg?.action === "sign_in") {
            if (msg?.content?.status && msg.content.status !== "success") {
              finish(
                new Error(
                  `WebSocket sign_in failed: ${
                    msg.content.message ?? "not authenticated"
                  }`
                )
              );
              return;
            }
            ws.send(
              JSON.stringify({ action: "subscribe", value: "host_actions", extra: {} })
            );
            return;
          }
          // The snapshot (and any live updates) arrive as host_actions messages;
          // a subscribe ack means the snapshot is imminent. Either way, settle.
          if (
            msg?.group === "host_actions" ||
            (msg?.group === "system" && msg?.action === "subscribe")
          ) {
            scheduleSettle();
          }
        });

        ws.on("error", (e: Error) => finish(e));
        ws.on("close", () => finish());
      })
      .catch((e) => finish(e instanceof Error ? e : new Error(String(e))));
  });
}
