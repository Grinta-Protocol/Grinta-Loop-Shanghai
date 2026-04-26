# V11 Production Checklist

V11 deploy bakes **demo-friendly** values into the constructor so the demo runs
out of the box. The on-chain ParameterGuard policy was tightened to a
**conservative live** shape on 2026-04-25 (see `app/scripts/apply-conservative-policy.ts`).
This checklist tracks what still needs to flip before mainnet hand-off.

## Source of truth for constants

- `tests/test_common.cairo` — `KP`, `KI`, `NOISE_BARRIER`, `INTEGRAL_PERIOD_SIZE`,
  `FEEDBACK_UPPER_BOUND`, `FEEDBACK_LOWER_BOUND`, `PER_SECOND_LEAK`
- `scripts/deploy_sepolia_v11.sh` — constructor args
- `app/scripts/apply-conservative-policy.ts` — applied 2026-04-25 (live policy)
- `app/scripts/demo_mode.ts` — runtime overrides applied after deploy

## PID Controller — what to change for prod

| Parameter | V11 deploy (constructor) | Live (2026-04-25) | Prod target | Setter |
|---|---|---|---|---|
| `kp` | `1_000_000_000_000` (1e-6 WAD) | `666_666_666_667` (6.67e-7 WAD) | `150_000_000_000` (1.5e-7 WAD, HAI mainnet) | agent propose via Guard |
| `ki` | `1_000_000` (1e-12 WAD) | `666_667` (6.67e-13 WAD) | `24_000` (2.4e-14 WAD, HAI mainnet) | agent propose via Guard |
| `noise_barrier` | `1.0 WAD` (disabled) | unchanged | `995_000_000_000_000_000` (0.995 WAD — 0.5% dead band) | `proxy_set_noise_barrier` via Guard |
| `integral_period_size` | `5` seconds | unchanged | `3600` seconds (1 hour) | add setter proxy if needed, or redeploy |
| `feedback_output_upper_bound` | `1e27` RAY | unchanged | `1e27` RAY (no change) | — |
| `feedback_output_lower_bound` | `-1e27` | unchanged | `-1e27` (no change) | — |
| `per_second_cumulative_leak` | `999_999_732_582_142_021_614_955_959` (30d half-life) | unchanged | same | `proxy_set_per_second_cumulative_leak` via Guard |

**Already done in V11:**
- [x] `pid.reset_deviation()` — clears integrator windup (added in V11 redeploy)
- [x] `safe_engine.reset_redemption_price(1e27, 1e27)` — re-pegged at V11 deploy

## GrintaHook — throttle intervals

| Parameter | Live | Prod target |
|---|---|---|
| `price_update_interval` | `1` s | `60` s |
| `rate_update_interval` | `1` s | `3600` s |

Setters: `hook.set_price_update_interval(n)`, `hook.set_rate_update_interval(n)` (admin only).

## ParameterGuard policy

| Field | V11 deploy | Live (2026-04-25) | Prod target |
|---|---|---|---|
| `kp_min` | `1e-7 WAD` | `333_333_333_333` (3.33e-7 WAD) | `50_000_000_000` (5e-8 WAD) |
| `kp_max` | `1e-5 WAD` | `1_000_000_000_000` (1e-6 WAD) | `500_000_000_000` (5e-7 WAD) |
| `ki_min` | `1e-13 WAD` | `333_333` (3.33e-13 WAD) | `10_000` |
| `ki_max` | `1e-10 WAD` | `1_000_000` (1e-12 WAD) | `500_000` |
| `max_kp_delta` | `5_000_000_000_000` | `66_666_666_667` (10% of baseline) | `15_000_000_000` (~10% of kp_max) |
| `max_ki_delta` | `50_000_000` | `66_667` (10% of baseline) | `50_000` |
| `cooldown_seconds` | `5` | `5` | `3600` |
| `emergency_cooldown_seconds` | `3` | `3` | `300` |
| `max_updates` | `1000` | `1000` | `50` |

Apply with `guard.set_policy({...})` (admin only). For non-trivial jumps (e.g. resetting gains far from baseline), use the loosen→propose→retighten pattern (`app/scripts/apply-conservative-policy.ts`).

## Hand-off sequence (live → prod)

1. ~~`pid.reset_deviation()`~~ — done in V11
2. ~~`safe_engine.reset_redemption_price(1e27, 1e27)`~~ — done in V11
3. Guard: `set_policy(prod_policy)` — tighten bounds and cooldowns (use loosen→propose→retighten if gains far from prod baseline)
4. Agent proposes prod Kp/Ki via `propose_parameters`
5. `proxy_set_noise_barrier(0.995e18)` — enable dead band
6. `proxy_set_per_second_cumulative_leak(30d_half_life)` — verify no drift from demo
7. `hook.set_price_update_interval(60)`, `hook.set_rate_update_interval(3600)`
8. `pid.set_integral_period_size(3600)` — requires admin (Guard), so need `guard.proxy_set_integral_period_size` (add if missing)
9. **Update `app/server/index.ts` `POLICY` constants** to mirror new on-chain policy (server-side clamping must match Guard)
10. **Update agent prompt** in `agent/src/reasoning.ts` and `app/server/index.ts` to mirror new bounds (drift causes LLM to propose values the chain rejects)

## Gaps to close before prod

- [ ] ParameterGuard: add `proxy_set_integral_period_size` (currently only `proxy_set_seed_proposer`, `proxy_set_noise_barrier`, `proxy_set_per_second_cumulative_leak`)
- [ ] PID: add `set_feedback_output_upper_bound` / `set_feedback_output_lower_bound` setters (currently only settable at construction)
- [ ] PID: add `replace_class` for upgradability (SAFEEngine already has it)
- [ ] Audit: get external review of the RAY migration before mainnet
- [ ] Invariant tests: add property tests that verify rate magnitude scales linearly with deviation across Kp/Ki ranges
- [ ] Monitoring: on-chain dashboard for integral value, noise barrier hit rate, feedback bound clips
