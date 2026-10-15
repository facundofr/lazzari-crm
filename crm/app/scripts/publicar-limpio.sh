#!/bin/bash
# (Guardado en el repo para que lo use cualquier sesión de Claude) Publica SOLO los archivos listados en $@ desde una copia limpia de origin/main (no sube trabajo sin terminar de otros chats).
# Uso: publicar.sh "mensaje del commit" archivo1 archivo2 ...   (rutas desde la raíz del repo)
cd /c/Users/lazza/lazzari || exit 1
MSG="$1"; shift
git fetch -q
WT=/c/Users/lazza/lz-pub-auto
git worktree remove --force $WT >/dev/null 2>&1; rm -rf $WT
git worktree add --detach $WT origin/main >/dev/null 2>&1 || { echo "no se pudo crear la copia"; exit 1; }
for f in "$@"; do mkdir -p "$WT/$(dirname "$f")"; cp "$f" "$WT/$f"; done
ACT=$(grep -o '"1\.1\.[0-9]*"' $WT/crm/app/src/lib/app-version.ts | tr -d '"')
N=${ACT##*.}; NUEVA="1.1.$((N+1))"
sed -i "s/APP_VERSION = \"$ACT\"/APP_VERSION = \"$NUEVA\"/" $WT/crm/app/src/lib/app-version.ts
cmd //c "mklink /J C:\\Users\\lazza\\lz-pub-auto\\crm\\app\\node_modules C:\\Users\\lazza\\lazzari\\crm\\app\\node_modules" >/dev/null
cp -r crm/app/.vercel $WT/crm/app/.vercel
cd $WT/crm/app
npx.cmd tsc --noEmit 2>&1 | head -5
node scripts/check-hooks.mjs | tail -1
cd $WT
git add -A crm docs
git -c core.safecrlf=false commit -q -m "V$NUEVA: $MSG

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" 2>/dev/null
git push -q origin HEAD:main 2>&1 | tail -1
git log --oneline -1 | cut -c1-80
cd crm/app
vercel.cmd --prod --yes > /tmp/vauto.txt 2>&1
U=$(grep -o "https://lazzari-[a-z0-9]*-augusto[^ ]*" /tmp/vauto.txt | grep -v vercel.com | head -1)
for i in $(seq 1 40); do s=$(vercel.cmd inspect $U 2>&1 | grep -E "status" | head -1); echo "$s" | grep -qE "Ready|Error|Canceled" && break; sleep 10; done
echo "V$NUEVA $s"
# dejar la carpeta principal alineada con lo publicado (sin tocar el trabajo de otros)
cd /c/Users/lazza/lazzari
git fetch -q
if git merge-base --is-ancestor main origin/main; then git update-ref refs/heads/main origin/main; git reset -q; fi
git worktree remove --force $WT >/dev/null 2>&1
