import {
  Req,
  Res,
  HttpCode,
  SetMetadata,
  type CustomDecorator,
} from '@nestjs/common';
export const Public = (): CustomDecorator => SetMetadata('public', true);
// Apply Nest parameter metadata explicitly so Node ESM and the test runner use the same classes.
export function route(
  target: object,
  name: string,
  decorator: MethodDecorator,
  isPublic = false,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(target, name);
  if (!descriptor) throw new Error('Missing route method');
  decorator(target, name, descriptor);
  HttpCode(200)(target, name, descriptor);
  Req()(target, name, 0);
  Res({ passthrough: true })(target, name, 1);
  if (isPublic) Public()(target, name, descriptor);
}
