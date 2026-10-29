import createPlanAgent from "./plan.ts";
import createStoriesAgent from "./stories.ts";
import createReviewAgent from "./review.ts";
import createReleaseAgent from "./release.ts";
import createSecurityAgent from "./security.ts";
import createTestsAgent from "./tests.ts";
import createInceptionAgent from "./inception.ts";

export function createAgents(model: string) {
  // ---------- 1. Requirements -> user stories ----------
  const stories = createStoriesAgent({
    model,
  });

  // ---------- 2. Design / technical plan ----------
  const plan = createPlanAgent({
    model,
  });

  // ---------- 3. Code review ----------
  const review = createReviewAgent({
    model,
  });

  // ---------- 4a. Tests ----------
  const tests =  createTestsAgent({
    model,
  });

  // ---------- 4b. Release notes ----------
  const release =  createReleaseAgent({
    model,
  });
  // ---------- 5. Security ----------
  const security =  createSecurityAgent({
    model,
  });

  // ---------- 6. Project inception (onboarding + baseline audit, read-only) ----------
  const inception = createInceptionAgent({
    model,
  });

  return { stories, plan, review, tests, release, security, inception };
}

export type Agents = ReturnType<typeof createAgents>;
export type StoriesResult = Awaited<ReturnType<Agents["stories"]>>;
export type PlanResult = Awaited<ReturnType<Agents["plan"]>>;
export type ReviewResult = Awaited<ReturnType<Agents["review"]>>;
export type TestsResult = Awaited<ReturnType<Agents["tests"]>>;
export type ReleaseResult = Awaited<ReturnType<Agents["release"]>>;
export type SecurityResult = Awaited<ReturnType<Agents["security"]>>;
export type InceptionResult = Awaited<ReturnType<Agents["inception"]>>;
