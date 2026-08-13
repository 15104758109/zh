declare module "node:https" {
  type ResponseListener = (response: {
    statusCode?: number;
    setEncoding(encoding: string): void;
    on(event: "data", listener: (chunk: string) => void): void;
    on(event: string, listener: (...args: unknown[]) => void): void;
    once(event: "error", listener: (error: Error) => void): void;
    once(event: "end", listener: () => void): void;
    destroy(error?: Error): void;
    once(event: string, listener: (...args: unknown[]) => void): void;
  }) => void;

  type ClientRequest = {
    once(event: "error", listener: (error: Error) => void): void;
    setTimeout(timeoutMs: number, listener: () => void): void;
    destroy(error?: Error): void;
    end(body?: string): void;
  };

  export function request(
    url: URL,
    options: { method?: string; headers?: Record<string, string> },
    listener: ResponseListener,
  ): ClientRequest;
}
