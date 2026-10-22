#!/bin/bash
# THREAD 4 golden-path verification — читающая верификация живого стека.
# БЕЗ pkill: стек должен уже жить (см. scripts/boot-t4.sh). Логи: tool-results/.
set -u
ROOT=/home/z/my-project
OUT="$ROOT/tool-results"
mkdir -p "$OUT"
exec > "$OUT/verify-run.log" 2>&1
AB="timeout 40 agent-browser"
fail=0
chk() { # chk <имя> <условие-строка ok/FAIL>
  if [ "$2" = "OK" ]; then echo "[OK] $1"; else echo "[FAIL] $1"; fail=1; fi
}

echo "[`date +%T`] http"
curl -s -m 5 http://127.0.0.1:3200/v1/health | rg -q '"ok":true' && chk "engine :3200" OK || chk "engine :3200" FAIL
curl -s -m 5 http://127.0.0.1:3201/v1/health | rg -q '"ok":true' && chk "twin :3201" OK || chk "twin :3201" FAIL
V=$(curl -s -m 10 http://127.0.0.1:3201/v1/chain/verify)
echo "$V" | rg -q '"ok":true' && chk "chain verify (twin)" OK || chk "chain verify (twin)" FAIL
echo "  chain: $(echo "$V" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d["data"]["events"], d["data"]["head"][:10])' 2>/dev/null)"
S=$(curl -s -m 20 "http://127.0.0.1:3000/api/t4/state")
echo "$S" | rg -q '"degraded":false' && chk "state degraded:false" OK || chk "state degraded:false" FAIL
C=$(curl -s -m 20 "http://127.0.0.1:3000/api/t4/cycle")
echo "$C" | rg -q '"ok":true' && chk "cycle kromka" OK || chk "cycle kromka" FAIL
B=$(curl -s -m 20 "http://127.0.0.1:3000/api/t4/engine/batches?limit=50")
echo "$B" | rg -q '"slug":"T4-33".*?"status":"delivered"' && chk "T4-33 delivered (реконсиляция)" OK || chk "T4-33 delivered (реконсиляция)" FAIL

echo "[`date +%T`] browser"
$AB set viewport 1440 900 >/dev/null 2>&1
$AB open http://127.0.0.1:3000 >/dev/null 2>&1
sleep 7
R=$($AB eval "document.body.textContent.indexOf('THREAD 4')>=0 ? 'OK' : 'FAIL'"); chk "рендер десктопа" "$R"
$AB eval "(function(){var b=[...document.querySelectorAll('button')].find(function(x){return x.textContent.trim()==='Скорборд'}); if(b) b.click(); return 1})()" >/dev/null
sleep 2.5
R=$($AB eval "var r=[...document.querySelectorAll('tr')].find(function(t){return t.textContent.indexOf('T4-33')>=0}); r && r.textContent.indexOf('delivered')>=0 ? 'OK' : 'FAIL'"); chk "T4-33 в скорборде delivered" "$R"
$AB screenshot "$OUT/verify-score.png" >/dev/null 2>&1
$AB eval "(function(){var b=[...document.querySelectorAll('button')].find(function(x){return x.textContent.trim()==='Хеш-цепь'}); if(b) b.click(); return 1})()" >/dev/null
sleep 3
R=$($AB eval "document.body.textContent.indexOf('ЦЕЛА')>=0 ? 'OK' : 'FAIL'"); chk "хеш-цепь ЦЕЛА (UI)" "$R"
$AB screenshot "$OUT/verify-chain.png" >/dev/null 2>&1
F=$($AB eval "var f=document.querySelector('footer'); JSON.stringify({exists: !!f, atBottom: f? Math.abs(f.getBoundingClientRect().bottom - window.innerHeight)<90 : false})")
echo "  footer: $F"
$AB set viewport 390 844 >/dev/null 2>&1
sleep 1.5
R=$($AB eval "document.documentElement.scrollWidth > document.documentElement.clientWidth ? 'FAIL' : 'OK'"); chk "мобильный 390px без оверфлоу" "$R"
$AB screenshot "$OUT/verify-mobile.png" >/dev/null 2>&1
echo "[`date +%T`] console errors"
timeout 15 agent-browser errors 2>/dev/null | tail -4
timeout 15 agent-browser close >/dev/null 2>&1

echo "[`date +%T`] engine logs (tail)"
tail -2 "$ROOT/t4-engine.log" 2>/dev/null
tail -2 "$ROOT/t4-engine-rs.log" 2>/dev/null
[ "$fail" = "0" ] && echo "=== ALL OK ===" || echo "=== THERE ARE FAILURES ==="
exit "$fail"
