import { ArgumentMetadata, BadRequestException, PipeTransform, UsePipes } from '@nestjs/common';
import { z } from 'zod';

export const idSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const email = z.email().max(254);
const password = z
  .string()
  .min(1)
  .refine((v) => Buffer.byteLength(v, 'utf8') <= 72, 'Password exceeds 72 bytes');
export const schemas = {
  register: z
    .object({
      email,
      password: password.refine((v) => v.length >= 12, 'Use at least 12 characters'),
      fullName: z.string().trim().max(100).optional(),
    })
    .strict(),
  login: z.object({ email, password }).strict(),
  google: z.object({ idToken: z.string().min(1).max(8192) }).strict(),
  profile: z
    .object({
      fav_constructor: idSchema.nullable().optional(),
      fav_drivers: z.array(idSchema).max(2).optional(),
    })
    .strict(),
  deletion: z.object({ userId: idSchema, email, reason: z.string().max(2000).optional() }).strict(),
  replay: z
    .object({
      path: z
        .string()
        .max(300)
        .regex(/^\d{4}\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/$/),
      name: z.string().max(200).optional(),
      speed: z.number().finite().min(0.25).max(64).optional(),
    })
    .strict(),
  replayControl: z
    .object({
      speed: z.number().finite().min(0.25).max(64).optional(),
      offsetMs: z.number().finite().min(0).max(86_400_000).optional(),
    })
    .strict(),
};
export class BodySchemaPipe implements PipeTransform {
  constructor(private readonly schema: z.ZodType) {}
  transform(value: unknown, metadata: ArgumentMetadata) {
    if (metadata.type !== 'body') return value;
    const result = this.schema.safeParse(value || {});
    if (!result.success)
      throw new BadRequestException({
        message: 'Invalid request body',
        errors: result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    return result.data;
  }
}
export const ValidateBody = (schema: z.ZodType) => UsePipes(new BodySchemaPipe(schema));

/** Runtime boundaries apply even when TypeScript types were erased. */
function assertSafeJson(value: unknown, depth = 0): void {
  if (depth > 16) throw new BadRequestException('Request nesting is too deep');
  if (!value || typeof value !== 'object') return;
  const entries = Object.entries(value);
  if (entries.length > 100) throw new BadRequestException('Too many request fields');
  for (const [key, item] of entries) {
    if (['__proto__', 'constructor', 'prototype'].includes(key))
      throw new BadRequestException('Invalid request field');
    assertSafeJson(item, depth + 1);
  }
}
export class InputValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata) {
    if (metadata.type === 'param' || metadata.type === 'query') {
      if (!value || typeof value !== 'object') return value;
      for (const [key, item] of Object.entries(value)) {
        if (typeof item !== 'string' || item.length > 256)
          throw new BadRequestException('Invalid request parameters');
        if (
          ['season', 'year'].includes(key) &&
          (!/^\d{4}$/.test(item) || +item < 1950 || +item > new Date().getUTCFullYear() + 1)
        )
          throw new BadRequestException('Invalid season or year');
        if (key === 'round' && (!/^\d{1,2}$/.test(item) || +item < 1 || +item > 30))
          throw new BadRequestException('Invalid round');
        if (
          ['id', 'driverId1', 'driverId2', 'table', 'column'].includes(key) &&
          !idSchema.safeParse(item).success
        )
          throw new BadRequestException('Invalid identifier');
        if (
          ['page', 'limit'].includes(key) &&
          (!/^\d+$/.test(item) || +item < 1 || +item > (key === 'limit' ? 500 : 10000))
        )
          throw new BadRequestException('Invalid pagination');
      }
    }
    if (metadata.type === 'body') assertSafeJson(value);
    if (
      metadata.type === 'body' &&
      value !== undefined &&
      (!value || typeof value !== 'object' || Array.isArray(value))
    )
      throw new BadRequestException('Expected a JSON object');
    return value;
  }
}
