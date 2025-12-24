/**
 * general: models good at everything
 * coder: specialized models for coding
 *
 * low: models with low reasoning
 * medium: models with moderate reasoning
 * high: models with high reasoning
 *
 * fast: faster model with lower reasoning
 * slow: slower model with higher reasoning
 */
export const models = {
    general: {
        low: {
            fast: "gpt-4.1-nano", // $0.10 | $0.40
            slow: "gpt-5-nano" // $0.05 | $0.40
        },
        medium: {
            fast: "gpt-4.1-mini", // $0.40 | $1.60
            slow: "gpt-5-mini" // $0.25 | $2.00
        },
        high: {
            fast: "gpt-4.1", // $2.00 | $8.00
            slow: "gpt-5.1" // $1.25 | $10.00
        }
    },
    coder: {
        low: {
            fast: "gpt-5.1-codex-mini", // $0.25 | $2.00
            slow: "gpt-5.1-codex-mini" // $0.25 | $2.00
        },
        medium: {
            fast: "gpt-5.1-codex-mini", // $0.25 | $2.00
            slow: "gpt-5.1-codex-mini" // $0.25 | $2.00
        },
        high: {
            fast: "gpt-5.1-codex-max", // $1.25 | $10.00
            slow: "gpt-5.1-codex-max" // $1.25 | $10.00
        }
    }
};
