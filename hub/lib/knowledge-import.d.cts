export type KnowledgeImportState = {
  fileName: string;
  error: string | null;
  pending: boolean;
};

export function createKnowledgeImportController(
  onStateChange: (state: KnowledgeImportState) => void,
  maxBytes?: number
): {
  select(file: File | null, input: HTMLInputElement | null): boolean;
  cancel(input: HTMLInputElement | null): void;
  submit(
    input: HTMLInputElement | null,
    form: HTMLFormElement,
    upload: (form: HTMLFormElement) => Promise<void>,
    onSuccess?: () => void
  ): Promise<boolean>;
};

export const DEFAULT_MAX_FILE_BYTES: number;
export function validateKnowledgeFile(file: { name: string; size: number } | null, maxBytes?: number): string | null;
