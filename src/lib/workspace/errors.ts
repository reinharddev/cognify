// Galat dari penyimpanan lokal: `code` dari Rust (`not_found`, `invalid`, `db_error`) atau `unknown`.

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
