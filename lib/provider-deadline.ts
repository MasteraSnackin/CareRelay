export interface ProviderDeadline {
  readonly signal: AbortSignal;
  race<T>(operation: Promise<T>): Promise<T>;
  close(): void;
}

function interruptedProviderRequest(): Error {
  return new Error("The provider request was interrupted.");
}

function discardLateProviderValue(value: unknown): void {
  if (value instanceof Response && value.body) {
    void value.body
      .cancel("provider request already interrupted")
      .catch(() => undefined);
  }
}

/**
 * Apply one deadline to both the provider fetch and its streamed response.
 * Passing an AbortSignal to fetch alone is insufficient for injected or
 * non-standard fetch implementations which resolve headers and then leave a
 * response body pending indefinitely.
 */
export function createProviderDeadline(
  timeoutMs: number,
  parentSignal?: AbortSignal,
): ProviderDeadline {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener("abort", abortFromParent, {
      once: true,
    });
  }
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    race<T>(operation: Promise<T>): Promise<T> {
      if (controller.signal.aborted) {
        void operation.then(discardLateProviderValue, () => undefined);
        return Promise.reject(interruptedProviderRequest());
      }
      return new Promise<T>((resolve, reject) => {
        const interrupted = () => {
          controller.signal.removeEventListener("abort", interrupted);
          reject(interruptedProviderRequest());
        };
        controller.signal.addEventListener("abort", interrupted, {
          once: true,
        });
        void operation.then(
          (value) => {
            controller.signal.removeEventListener("abort", interrupted);
            if (controller.signal.aborted) {
              discardLateProviderValue(value);
              reject(interruptedProviderRequest());
              return;
            }
            resolve(value);
          },
          (error: unknown) => {
            controller.signal.removeEventListener("abort", interrupted);
            reject(error);
          },
        );
      });
    },
    close(): void {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
  };
}
