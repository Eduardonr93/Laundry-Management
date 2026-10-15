export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const bad = (message) => new HttpError(400, message);
export const notFound = (message = 'No encontrado') => new HttpError(404, message);
export const forbidden = (message = 'No tienes permiso para esta acción') => new HttpError(403, message);
