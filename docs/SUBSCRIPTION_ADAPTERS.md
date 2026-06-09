# Subscription Adapter Notes

The project does not attempt to become a full subscription converter. The Worker owns tunnel-aware node derivation and delegates or isolates format conversion behind an adapter boundary.

## Built-in Adapter Scope

The built-in adapter supports the CDN-friendly subset needed by the first release:

- `vless://`
- `vmess://`
- `trojan://`
- `ss://`
- sing-box outbound JSON

For tunnel-backed nodes it updates:

- client server/address to the selected preferred endpoint or tunnel hostname
- TLS SNI / server name to the current tunnel hostname
- WebSocket HTTP Host to the current tunnel hostname
- node display name with endpoint suffixes

Unsupported or malformed nodes are skipped with a reason in subscription preview.

## External Projects Reviewed

| Project | Use in this project |
| --- | --- |
| `7Sageer/sublink-worker` | Primary reference and future reuse candidate. MIT license, Worker-compatible, supports Shadowsocks, VMess, VLESS, Trojan, sing-box, and Xray/V2Ray outputs. |
| `sub-store-org/Sub-Store` | Compatibility reference. Broad format support but heavier and AGPL-3.0 licensed. |
| `tindy2013/subconverter` | Optional external backend candidate. Mature converter, but GPL-3.0 and runs as a separate service. |

## Future Extension Point

`SUBCONVERTER_URL` is reserved for a later external conversion backend. The first release keeps conversion local so Worker deployment stays self-contained.

