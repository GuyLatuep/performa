import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library registers its own automatic cleanup only when vitest runs
// with `globals: true`, which this project deliberately does not. Without it a
// tree rendered by one test stays in `document.body` for the next one, and a
// `screen` query then finds two matching elements and throws.
//
// Component test files import this once, for the side effect, alongside their
// `@vitest-environment happy-dom` docblock.
afterEach(cleanup);
