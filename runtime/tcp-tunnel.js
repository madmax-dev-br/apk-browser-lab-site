// A TCP stream for a java.net.Socket whose conversation is not HTTP/1.1 (HTTP/2 with prior knowledge, as gRPC clients speak; MQTT; a database protocol), through the
// APK Lab Relay that runs on the user's computer (docs/NETWORK.md "TCP tunnel"). A browser cannot open TCP; the relay can: the page opens a WebSocket to the relay's tunnel endpoint
// and the relay connects to the target and copies the bytes both ways. Without a relay configured such a socket fails as before, explicitly.
//
// Protocol (the relay's /<token>/tcp endpoint): ws://127.0.0.1:<port>/<token>/tcp?host=<name>&port=<n>&tls=<0|1>&alpn=<list>. The relay's first message is text JSON:
// {"connected":true,"alpn":"h2"} or {"error":{"code":"ECONNREFUSED","message":"..."}} (then it closes). After it every message is binary: the TCP bytes, in order. A close of
// either side ends the stream (EOF). tls=1 asks the relay to do the TLS (the lab's SSLSocket hands the app's plaintext, as it does for fetch) and report the ALPN protocol the server
// chose. VM-free; no process.*.

/** The relay's tunnel endpoint for a device network: an explicit policy.tunnelUrl, or derived from an APK Lab Relay proxy URL (http(s)://host:port/<token>/?url={url}). Null when none. */
export function tunnelEndpoint(policy) {
  if (policy?.tunnelUrl) return String(policy.tunnelUrl);
  const proxy = String(policy?.proxyUrl ?? ''); if (!proxy.includes('{url}')) return null;
  let parsed; try { parsed = new URL(proxy.replace('{url}', 'x')); } catch { return null; }
  const match = /^\/([A-Za-z0-9_-]{8,128})\/?$/.exec(parsed.pathname); if (!match) return null;
  return `${parsed.protocol === 'https:' ? 'wss:' : 'ws:'}//${parsed.host}/${match[1]}/tcp`;
}

/**
 * Opens a tunnel: { connected, alpn, error, closed, queue (bytes for the app), send(bytes), close(), dispose() }. `create(url)` makes the realm's WebSocket; `signal()` wakes the VM
 * when bytes, the connection or the end arrived.
 */
export function openTunnelSession({ endpoint, host, port, tls = false, alpn = [], create = url => new globalThis.WebSocket(url), signal = () => {} }) {
  const session = { connected: false, alpn: null, error: null, closed: false, queue: [], queued: 0, pending: [], bytesIn: 0, bytesOut: 0 };
  const query = new URLSearchParams({ host, port: String(port), tls: tls ? '1' : '0', ...(alpn.length ? { alpn: alpn.join(',') } : {}) });
  let socket;
  try { socket = create(`${endpoint}?${query}`); }
  catch (error) { session.error = { type: 'Ljava/net/ConnectException;', message: `failed to connect to ${host}/${port} through the relay: ${error?.message ?? error}` }; return session; }
  socket.binaryType = 'arraybuffer';
  socket.onmessage = event => {
    if (typeof event.data === 'string') {
      let message = null; try { message = JSON.parse(event.data); } catch { /* not ours */ }
      if (message?.connected) { session.connected = true; session.alpn = message.alpn ?? null; for (const bytes of session.pending.splice(0)) socket.send(bytes); }
      else if (message?.error) session.error = { type: message.error.code === 'ETIMEDOUT' ? 'Ljava/net/SocketTimeoutException;' : 'Ljava/net/ConnectException;', message: `failed to connect to ${host}/${port}: ${message.error.code ?? ''} ${message.error.message ?? ''}`.trim(), code: message.error.code ?? null };
      signal(); return;
    }
    const bytes = new Uint8Array(event.data); session.queue.push(bytes); session.queued += bytes.length; session.bytesIn += bytes.length; signal();
  };
  socket.onerror = () => { if (!session.connected && !session.error) { session.error = { type: 'Ljava/net/ConnectException;', message: `failed to connect to ${host}/${port}: the relay's tunnel did not answer (is APK Lab Relay running?)` }; signal(); } };
  socket.onclose = () => { if (!session.connected && !session.error) session.error = { type: 'Ljava/net/ConnectException;', message: `failed to connect to ${host}/${port}: the relay closed the tunnel` }; session.closed = true; signal(); };
  session.send = bytes => { session.bytesOut += bytes.length; if (session.connected) socket.send(bytes); else session.pending.push(bytes.slice()); };
  session.close = () => { try { socket.close(1000); } catch { /* closed */ } };
  session.dispose = () => { session.closed = true; try { if (socket.readyState < 2) socket.close(1000); } catch { /* gone */ } };
  return session;
}
