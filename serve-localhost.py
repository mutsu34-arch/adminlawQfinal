# -*- coding: utf-8 -*-
"""
정적 서버: IPv6 [::] 우선 → 실패 시 IPv4 0.0.0.0
→ http://localhost:5500/ 및 http://127.0.0.1:5500/ 접속 지원
"""
import http.server
import os
import socket
import socketserver
import sys


def main():
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5500
    base = os.path.dirname(os.path.abspath(__file__))
    os.chdir(base)
    print("[serve-localhost] working folder: %s" % base, flush=True)
    print("[serve-localhost] trying to open port %s ..." % port, flush=True)

    Handler = http.server.SimpleHTTPRequestHandler

    class ReusableV6(socketserver.TCPServer):
        address_family = socket.AF_INET6
        allow_reuse_address = True

        def server_bind(self):
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
            return socketserver.TCPServer.server_bind(self)

    class ReusableV4(socketserver.TCPServer):
        address_family = socket.AF_INET
        allow_reuse_address = True

    httpd = None
    last_err = None
    for ServerCls, host in ((ReusableV6, "::"), (ReusableV4, "0.0.0.0")):
        try:
            httpd = ServerCls((host, port), Handler)
            break
        except OSError as e:
            last_err = e
            print("바인드 실패 (%s): %s" % (host, e), file=sys.stderr)

    if httpd is None:
        print("서버를 시작할 수 없습니다.", file=sys.stderr)
        if last_err:
            raise last_err
        return 1

    try:
        a = httpd.socket.getsockname()
        port_out = a[1] if len(a) >= 2 else port
    except Exception:
        port_out = port

    print("")
    print("========================================")
    print("  브라우저 주소:")
    print("  http://localhost:%s/" % port_out)
    print("  http://127.0.0.1:%s/" % port_out)
    print("========================================")
    print("종료: Ctrl+C")
    print("")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n서버 종료.")
        return 0
    finally:
        httpd.server_close()


if __name__ == "__main__":
    try:
        sys.exit(main() or 0)
    except KeyboardInterrupt:
        print("\n서버 종료.")
        sys.exit(0)
