#!/usr/bin/env bash
# Generate a local CA + server cert so phone-server can serve HTTPS. The Screen
# Wake Lock API (keep-the-screen-awake) only works in a secure context, and a
# plain http://<LAN-IP> URL is NOT one — so the phone display needs https.
#
# Auto-detects the Mac's LAN IP and bakes it into the cert's SAN (iOS requires a
# SAN + serverAuth EKU + <=398-day validity, all set below). Re-run this if your
# IP changes; pass an explicit IP to override:  npm run certs -- 192.168.1.50
set -euo pipefail
D="$(cd "$(dirname "$0")/.." && pwd)/certs"
mkdir -p "$D"

IP="${1:-$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)}"
if [ -z "$IP" ]; then
  echo "gen-certs: could not detect a LAN IP — pass one: npm run certs -- 192.168.x.x" >&2
  exit 1
fi
echo "[certs] issuing for IP $IP"

# Root CA (install + trust THIS on the phone, once). Reused across runs — so if
# your IP changes you can re-issue just the leaf below and the phone keeps
# trusting the same CA, no re-install needed.
if [ ! -f "$D/rootCA.pem" ] || [ ! -f "$D/rootCA-key.pem" ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -keyout "$D/rootCA-key.pem" -out "$D/rootCA.pem" -days 3650 \
    -subj "/CN=echo local CA" \
    -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"
  echo "[certs] new root CA created — (re)install it on the phone"
else
  echo "[certs] reusing existing root CA — no need to re-trust on the phone"
fi

# Server leaf, signed by the CA, valid for the LAN IP.
openssl req -newkey rsa:2048 -nodes -keyout "$D/key.pem" -out "$D/leaf.csr" -subj "/CN=echo phone"
printf 'subjectAltName=IP:%s,IP:127.0.0.1,DNS:localhost\nextendedKeyUsage=serverAuth\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\n' "$IP" > "$D/leaf.ext"
openssl x509 -req -in "$D/leaf.csr" -CA "$D/rootCA.pem" -CAkey "$D/rootCA-key.pem" -CAcreateserial \
  -out "$D/cert.pem" -days 397 -extfile "$D/leaf.ext"

echo "[certs] done → $D"
echo "[certs] on the iPhone: open http://$IP:10757/ to install rootCA, then"
echo "        Settings → General → About → Certificate Trust Settings → enable it,"
echo "        then load https://$IP:10756/"
