type ProductCompletionCallbacks = {
  completionIncludesProgress: boolean;
  reportProgress: () => Promise<void>;
  reportCompletion?: () => Promise<void>;
  onCompletionError: (error: unknown) => void;
};

export async function reportCompletedProductCallbacks(
  callbacks: ProductCompletionCallbacks,
) {
  if (callbacks.completionIncludesProgress && callbacks.reportCompletion) {
    try {
      await callbacks.reportCompletion();
      return;
    } catch (error) {
      callbacks.onCompletionError(error);
      await callbacks.reportProgress();
      return;
    }
  }

  await callbacks.reportProgress();

  if (!callbacks.reportCompletion) return;

  try {
    await callbacks.reportCompletion();
  } catch (error) {
    callbacks.onCompletionError(error);
  }
}
