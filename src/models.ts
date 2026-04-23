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
      // Fast, cheap, no heavy reasoning
      fast: "gpt-4.1-nano", // $0.10 | $0.40
      // Cheap reasoning
      slow: "gpt-5-nano" // $0.05 | $0.40
    },
    medium: {
      // Fast instruction model
      fast: "gpt-4.1-mini", // $0.40 | $1.60
      // Good reasoning + cost balance
      slow: "gpt-5-mini" // $0.25 | $2.00
    },
    high: {
      // Fast but strong
      fast: "gpt-5-mini",
      // Best reasoning / flagship
      slow: "gpt-5.4"
    }
  },

  coder: {
    low: {
      fast: "gpt-5.1-codex-mini",
      slow: "gpt-5.1-codex-mini"
    },
    medium: {
      fast: "gpt-5-codex",
      slow: "gpt-5-codex"
    },
    high: {
      fast: "gpt-5.3-codex",
      slow: "gpt-5.3-codex"
    }
  }
};