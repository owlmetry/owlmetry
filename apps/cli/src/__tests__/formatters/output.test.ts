import { output } from "../../formatters/index.js";

describe("output", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("json format outputs JSON", () => {
    output("json", { foo: "bar" }, () => "table", () => "log");
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"foo"'));
  });

  it("table format calls table formatter", () => {
    const tableFn = vi.fn().mockReturnValue("table output");
    output("table", { data: true }, tableFn);
    expect(tableFn).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith("table output");
  });

  it("log format calls log formatter", () => {
    const logFn = vi.fn().mockReturnValue("log output");
    output("log", { data: true }, () => "table", logFn);
    expect(logFn).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith("log output");
  });

  it("log format falls back to JSON when no log formatter", () => {
    output("log", { foo: 1 }, () => "table");
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"foo"'));
  });
});
