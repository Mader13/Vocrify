export interface CommandResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}
