import { describe, it, expect } from "vitest";

import { parseNameOnlyList, isDeniedPath } from "../src/autocommit.js";

describe("parseNameOnlyList", () => {
  it("splits non-empty lines", () => {
    const text = "a\n\n b \n";
    expect(parseNameOnlyList(text)).toEqual(["a", "b"]);
  });

  it("handles Windows-style line endings", () => {
    const text = "a\r\nb\r\n";
    expect(parseNameOnlyList(text)).toEqual(["a", "b"]);
  });

  it("returns empty array for empty string", () => {
    expect(parseNameOnlyList("")).toEqual([]);
  });

  it("returns empty array for whitespace-only string", () => {
    expect(parseNameOnlyList("   \n  \n")).toEqual([]);
  });

  it("trims each line", () => {
    expect(parseNameOnlyList("  foo  \n  bar  ")).toEqual(["foo", "bar"]);
  });
});

describe("isDeniedPath", () => {
  it("blocks obvious secret-like paths", () => {
    expect(isDeniedPath(".env")).toBe(true);
    expect(isDeniedPath("config/credentials.json")).toBe(true);
  });

  it("blocks common build artifacts", () => {
    expect(isDeniedPath("dist/index.js")).toBe(true);
    expect(isDeniedPath("logs/output.log")).toBe(true);
  });

  it("allows normal source files", () => {
    expect(isDeniedPath("src/index.ts")).toBe(false);
  });

  // Secret / credential patterns
  it("blocks .env variants", () => {
    expect(isDeniedPath(".env.local")).toBe(true);
    expect(isDeniedPath(".env.production")).toBe(true);
    expect(isDeniedPath(".env.development")).toBe(true);
    expect(isDeniedPath(".env.test")).toBe(true);
    expect(isDeniedPath("app/.env")).toBe(true);
  });

  it("blocks secrets files", () => {
    expect(isDeniedPath(".secret")).toBe(true);
    expect(isDeniedPath("secrets.yaml")).toBe(true);
    expect(isDeniedPath("path/to/.secrets")).toBe(true);
  });

  it("blocks credential files", () => {
    expect(isDeniedPath("credentials.yml")).toBe(true);
    expect(isDeniedPath("credential.yaml")).toBe(true);
  });

  it("blocks key/certificate files", () => {
    expect(isDeniedPath("server.pem")).toBe(true);
    expect(isDeniedPath("id_rsa")).toBe(true);
    expect(isDeniedPath("id_rsa.pub")).toBe(true);
    expect(isDeniedPath("id_esa")).toBe(true);
    expect(isDeniedPath("cert.p12")).toBe(true);
    expect(isDeniedPath("keystore.jks")).toBe(true);
  });

  it("blocks files with password/api_key/token in name", () => {
    expect(isDeniedPath("password.txt")).toBe(true);
    expect(isDeniedPath("api_key.json")).toBe(true);
    expect(isDeniedPath("my-token.yaml")).toBe(true);
    expect(isDeniedPath("app_apikey.config")).toBe(true);
  });

  // Build artifact patterns
  it("blocks node_modules paths", () => {
    expect(isDeniedPath("node_modules/foo/index.js")).toBe(true);
    expect(isDeniedPath("node_modules")).toBe(true);
  });

  it("blocks dist/build/coverage paths", () => {
    expect(isDeniedPath("dist")).toBe(true);
    expect(isDeniedPath("build/output.js")).toBe(true);
    expect(isDeniedPath("coverage/lcov.info")).toBe(true);
  });

  it("blocks framework cache directories", () => {
    expect(isDeniedPath(".next/server/page.js")).toBe(true);
    expect(isDeniedPath(".nuxt/dist")).toBe(true);
    expect(isDeniedPath(".turbo/cache")).toBe(true);
    expect(isDeniedPath(".parcel-cache/data")).toBe(true);
    expect(isDeniedPath(".pytest_cache/v/cache")).toBe(true);
  });

  // .NET / IDE patterns
  it("blocks .NET build artifacts", () => {
    expect(isDeniedPath("bin/Debug/app.dll")).toBe(true);
    expect(isDeniedPath("obj/project.csproj")).toBe(true);
    expect(isDeniedPath("MyProject.csproj.user")).toBe(true);
    expect(isDeniedPath("solution.suo")).toBe(true);
  });

  it("blocks IDE caches", () => {
    expect(isDeniedPath(".vs/settings.json")).toBe(true);
    expect(isDeniedPath(".idea/workspace.xml")).toBe(true);
  });

  it("blocks log/temp/swap files", () => {
    expect(isDeniedPath("debug.log")).toBe(true);
    expect(isDeniedPath("temp.tmp")).toBe(true);
    expect(isDeniedPath(".swp")).toBe(true);
    expect(isDeniedPath("file.swo")).toBe(true);
    expect(isDeniedPath("backup~")).toBe(true);
  });

  // CMake patterns
  it("blocks CMake artifacts", () => {
    expect(isDeniedPath("CMakeFiles/target.dir")).toBe(true);
    expect(isDeniedPath("CMakeCache.txt")).toBe(true);
    expect(isDeniedPath("cmake-build-debug/output")).toBe(true);
  });

  // Negative cases
  it("allows normal project files", () => {
    expect(isDeniedPath("src/components/Button.tsx")).toBe(false);
    expect(isDeniedPath("README.md")).toBe(false);
    expect(isDeniedPath("package.json")).toBe(false);
    expect(isDeniedPath("tsconfig.json")).toBe(false);
    expect(isDeniedPath("tests/unit.test.ts")).toBe(false);
  });

  it("allows docs and config files", () => {
    expect(isDeniedPath("docs/guide.md")).toBe(false);
    expect(isDeniedPath(".gitignore")).toBe(false);
    expect(isDeniedPath(".editorconfig")).toBe(false);
  });

  // Sensitive directory patterns (R2)
  it("blocks .ssh directory", () => {
    expect(isDeniedPath(".ssh")).toBe(true);
    expect(isDeniedPath(".ssh/")).toBe(true);
    expect(isDeniedPath(".ssh/id_rsa")).toBe(true);
    expect(isDeniedPath(".ssh/config")).toBe(true);
    expect(isDeniedPath("home/.ssh/authorized_keys")).toBe(true);
  });

  it("blocks .gnupg directory", () => {
    expect(isDeniedPath(".gnupg")).toBe(true);
    expect(isDeniedPath(".gnupg/")).toBe(true);
    expect(isDeniedPath(".gnupg/secring.gpg")).toBe(true);
  });

  it("blocks .aws directory", () => {
    expect(isDeniedPath(".aws")).toBe(true);
    expect(isDeniedPath(".aws/")).toBe(true);
    expect(isDeniedPath(".aws/credentials")).toBe(true);
    expect(isDeniedPath(".aws/config")).toBe(true);
  });

  it("blocks .kube directory", () => {
    expect(isDeniedPath(".kube")).toBe(true);
    expect(isDeniedPath(".kube/")).toBe(true);
    expect(isDeniedPath(".kube/config")).toBe(true);
  });

  it("blocks sensitive config files", () => {
    expect(isDeniedPath(".npmrc")).toBe(true);
    expect(isDeniedPath(".pypirc")).toBe(true);
    expect(isDeniedPath("project/.npmrc")).toBe(true);
    expect(isDeniedPath("project/.pypirc")).toBe(true);
  });
});
