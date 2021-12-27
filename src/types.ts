import { ZodType } from 'zod';

export type Schema<T = any> = { [K in keyof T]: ZodType<T[K]> };

export type TypeOf<T> = T extends Schema<infer R> ? R : never;

export type Config<T, D = any> = {
  schema?: Schema<T> | boolean;
  onSubmit: (value: T) => Promise<D>;
  initialValues?: { [K in keyof T]: T[K] };
};
