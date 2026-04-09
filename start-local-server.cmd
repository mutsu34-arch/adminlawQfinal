@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo [한 줄만 실행] 이 창을 닫지 마세요. 서버가 꺼지면 브라우저도 안 열립니다.
echo 주소: http://127.0.0.1:5500/  (IPv4 고정 — localhost 실패할 때 이 주소만 쓰세요)
echo 같은 포트에 서버를 두 번 띄우면 연결 오류가 날 수 있습니다.
echo 종료: Ctrl+C  ^|  다른 명령은 Cursor에서 [터미널 +] 새 탭을 여세요.
echo.

py -m http.server -b 127.0.0.1 5500
