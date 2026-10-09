import { extname } from "node:path";

// Node's loader does not resolve extensionless TypeScript imports. Expo Metro does.
export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && extname(specifier) === "") {
    return nextResolve(`${specifier}.ts`, context);
  }
  return nextResolve(specifier, context);
}
