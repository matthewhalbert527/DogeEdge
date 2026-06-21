import crypto from "node:crypto";
import tls from "node:tls";
import { decodeServerWebSocketFrames, encodeClientWebSocketFrame, kalshiWsAuthHeaders } from "./kalshi-ws-replay.mjs";

export async function openKalshiWebSocket({ wsUrl, keyId, privateKeyPem, timeoutMs = 10_000 }) {
  const url = new URL(wsUrl);
  const pathWithQuery = `${url.pathname}${url.search}`;
  const timestamp = String(Date.now());
  const authHeaders = kalshiWsAuthHeaders({ keyId, privateKeyPem, timestamp, requestPath: url.pathname });
  if (!authHeaders.ok) throw new Error(authHeaders.reason);
  const websocketKey = crypto.randomBytes(16).toString("base64");
  const headers = [
    `GET ${pathWithQuery} HTTP/1.1`,
    `Host: ${url.host}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Key: ${websocketKey}`,
    "Sec-WebSocket-Version: 13",
    `KALSHI-ACCESS-KEY: ${authHeaders.keyId}`,
    `KALSHI-ACCESS-SIGNATURE: ${authHeaders.signature}`,
    `KALSHI-ACCESS-TIMESTAMP: ${authHeaders.timestamp}`,
    "User-Agent: DogeEdge/0.1",
    "",
    "",
  ].join("\r\n");
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: url.hostname, port: Number(url.port || 443), servername: url.hostname });
    let data = Buffer.alloc(0);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("websocket_handshake_timeout"));
    }, timeoutMs);
    socket.on("secureConnect", () => socket.write(headers));
    socket.on("data", function onHandshakeData(chunk) {
      data = Buffer.concat([data, chunk]);
      const marker = data.indexOf("\r\n\r\n");
      if (marker < 0) return;
      clearTimeout(timer);
      socket.off("data", onHandshakeData);
      const head = data.subarray(0, marker + 4).toString("utf8");
      const statusLine = head.split(/\r?\n/, 1)[0] ?? "";
      const status = Number(statusLine.match(/HTTP\/\d(?:\.\d)?\s+(\d+)/)?.[1] ?? 0);
      if (status !== 101) {
        socket.destroy();
        reject(new Error(`websocket_upgrade_failed_http_${status}`));
        return;
      }
      const remainder = data.subarray(marker + 4);
      if (remainder.length) socket.unshift(remainder);
      resolve(socket);
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export function captureWebSocketMessages({ socket, subscription, durationMs, onRawMessage, onError }) {
  return new Promise((resolve) => {
    let buffer = Buffer.alloc(0);
    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      try {
        socket.write(encodeClientWebSocketFrame(Buffer.alloc(0), { opcode: 8 }));
      } catch {
        // Ignore close-frame failures; capture artifacts remain fail-closed.
      }
      socket.end();
      resolve();
    };
    const timer = setTimeout(finish, durationMs);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      let decoded;
      try {
        decoded = decodeServerWebSocketFrames(buffer);
      } catch (error) {
        onError(error);
        finish();
        return;
      }
      buffer = decoded.remaining;
      for (const frame of decoded.frames) {
        if (frame.opcode === 0x9) {
          socket.write(encodeClientWebSocketFrame(frame.payload, { opcode: 0xA }));
          continue;
        }
        if (frame.opcode === 0x8) {
          finish();
          continue;
        }
        if (frame.opcode !== 0x1) continue;
        const text = frame.payload.toString("utf8");
        try {
          onRawMessage(JSON.parse(text));
        } catch (error) {
          onError(error);
        }
      }
    });
    socket.on("error", (error) => {
      onError(error);
      finish();
    });
    socket.on("close", finish);
    socket.write(encodeClientWebSocketFrame(JSON.stringify(subscription)));
  });
}
