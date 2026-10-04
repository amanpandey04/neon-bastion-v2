# Performance Numbers

All live values below are captured in the browser using the Performance Lab with the exact same stress workload:

```text
5,000 enemies
100 towers
1,000 projectiles
```

The submission uses two kinds of measurements:

- **A/B experiments:** short CPU measurements of the specific operation being optimized, with the same stress dataset loaded.
- **Final stress benchmark:** real browser `requestAnimationFrame` cadence over 30 seconds for the assignment's FPS thresholds.

## Historical initial baseline

The first LLM implementation was observed at roughly 10-20 FPS under the required stress workload.

| Version | Workload | Observed performance |
|---|---|---:|
| Initial LLM implementation | 5,000 / 100 / 1,000 | ~10-20 FPS |

## Live A/B experiments

Replace the values with the numbers shown by the Performance Lab after each live run. Do not invent or estimate values.

| Optimization | Before | After | Change |
|---|---:|---:|---:|
| Spatial grid target lookup, 100 tower passes | TBD ms | TBD ms | TBD% |
| Object pool reuse, 5,000 acquire/release operations | TBD ms | TBD ms | TBD% |


### Tested but not counted as a performance win

The projectile-math microbenchmark was removed from the live A/B panel because the target browser produced a small regression/noisy result. It is retained here as an example of an optimization that was tested and not used as a headline performance claim.

| Experiment | Before | After | Change | Decision |
|---|---:|---:|---:|---|
| Allocation-free projectile math, 1,000 updates | 0.07ms | 0.08ms | +14.4% | Not counted as a win |

## Final optimized benchmark

Capture these values after all production optimizations are enabled.

| Metric | Final value |
|---|---:|
| Enemies | 5,000 |
| Towers | 100 |
| Projectiles | 1,000 |
| Measured frames | TBD |
| Average browser frame interval | TBD ms |
| Worst browser frame interval | TBD ms |
| Average CPU work | TBD ms |
| Worst CPU work | TBD ms |
| Frames meeting ≥45 FPS | TBD% |
| Frames above 33ms | TBD% |
| Assignment result | TBD |

## Measurement notes

- The initial baseline is retained as the historical breaking-point observation from the earlier implementation.
- A/B experiments isolate the selected operation so the before/after result is attributable to that code path rather than browser scheduling noise.
- The final assignment result is based on real browser frame cadence: at least 95% of frames must meet the 45 FPS threshold and fewer than 5% may exceed 33ms.
- The stress harness keeps exactly 5,000 enemies, 100 towers, and 1,000 projectiles active during the final measurement.
- Stress rendering uses lightweight batched primitives and skips objects outside the visible canvas. Normal gameplay retains the detailed visuals.
- Run the benchmark in a visible, foreground browser tab and avoid recording with DevTools Performance active during the final measurement.
