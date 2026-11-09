@echo off
chcp 65001 >nul
rem GitHub 서버(해외)에서 국내 API 수집이 막힐 때 쓰는 대안: 이 PC에서 수집한 뒤 GitHub에 올린다.
rem 더블클릭으로 실행. .env 파일에 API 키가 있어야 한다.
cd /d "%~dp0"
echo [1/3] 데이터 수집 중... (몇 분 걸립니다)
python collector\collect.py
if errorlevel 1 (
  echo 수집 중 오류가 났습니다. 위 메시지를 확인하세요. 올리지 않고 끝냅니다.
  pause
  exit /b 1
)
echo [2/3] 변경 내용 저장
git add data
git commit -m "PC에서 데이터 갱신 %date% %time:~0,5%"
echo [3/3] GitHub에 올리는 중
git push
echo 완료. 1~2분 뒤 https://koocksun-droid.github.io/gangseo_dashboard/ 에 반영됩니다.
pause
