import { UsersRepository } from './users.repository.ts';
import { AuthRepository } from '../auth/auth.repository.ts';
import { Passwords } from '../auth/passwords.ts';
import { ApiError } from '../common/errors.ts';
export class UsersService {
  private readonly users: UsersRepository;
  private readonly auth: AuthRepository;
  private readonly passwords: Passwords;
  constructor(
    users: UsersRepository,
    auth: AuthRepository,
    passwords: Passwords,
  ) {
    this.users = users;
    this.auth = auth;
    this.passwords = passwords;
  }
  async export(userId: string) {
    await this.auth.audit(userId, 'account.export', null);
    return this.users.export(userId);
  }
  async delete(userId: string, password: string) {
    const user = await this.auth.userById(userId);
    const record = user ? await this.auth.userByEmail(user.email) : null;
    if (!(await this.passwords.verify(record?.passwordHash, password)))
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
    await this.users.delete(userId);
  }
}
