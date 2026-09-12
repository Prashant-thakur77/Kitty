#!/usr/bin/env bash
# Polls the deployer's tCTC balance on CC3 Testnet; prints one line when it is funded, then exits.
A=0xD793169c516c9F9A334218608fbF6E1338b3DE56
while true; do
  B=$(cast balance --ether "$A" --rpc-url https://rpc.cc3-testnet.creditcoin.network 2>/dev/null | head -1)
  if [ -n "$B" ] && [ "$(echo "$B > 0.002" | bc -l 2>/dev/null)" = "1" ]; then echo "FUNDED $B tCTC"; exit 0; fi
  sleep 60
done
