'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ArrowRight, Eye, EyeOff, LoaderCircle } from 'lucide-react';
import { loginSchema, type LoginInput } from '@jobpilot/shared';
import { apiClient, ApiClientError } from '@/lib/api-client';
import { useSession, sessionKey } from '@/lib/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form';
export function LoginForm() {
  const t = useTranslations('Login');
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useSession();
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });
  const mutation = useMutation({
    mutationFn: (input: LoginInput) => apiClient.login(input),
    onSuccess: async () => {
      form.reset();
      await queryClient.invalidateQueries({ queryKey: sessionKey });
      router.replace('/dashboard');
    },
    onError: (error: unknown) => {
      setMessage(
        t(
          error instanceof ApiClientError && error.status === 401
            ? 'credentials'
            : error instanceof ApiClientError && error.status === 429
              ? 'rateLimit'
              : 'unavailable',
        ),
      );
    },
  });
  useEffect(() => {
    if (session.data) router.replace('/dashboard');
  }, [session.data, router]);
  return (
    <Form {...form}>
      <form
        noValidate
        className="login-form"
        onSubmit={form.handleSubmit(
          (value) => {
            setMessage(null);
            mutation.mutate(value);
          },
          (errors) => {
            if (errors.email)
              form.setError('email', { message: t('invalidEmail') });
            if (errors.password)
              form.setError('password', { message: t('requiredPassword') });
          },
        )}
      >
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('email')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="email"
                  autoComplete="username"
                  placeholder={t('emailPlaceholder')}
                  className="login-input"
                  disabled={mutation.isPending}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('password')}</FormLabel>
              <div className="password-field">
                <FormControl>
                  <Input
                    {...field}
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    className="login-input pr-12"
                    disabled={mutation.isPending}
                  />
                </FormControl>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="password-toggle"
                  aria-label={t(showPassword ? 'hidePassword' : 'showPassword')}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? (
                    <EyeOff aria-hidden="true" className="size-4" />
                  ) : (
                    <Eye aria-hidden="true" className="size-4" />
                  )}
                </Button>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
        {message && (
          <p className="login-error" role="alert">
            {message}
          </p>
        )}
        <Button
          type="submit"
          size="lg"
          className="login-submit"
          disabled={mutation.isPending}
        >
          {mutation.isPending ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : null}
          {t(mutation.isPending ? 'submitting' : 'submit')}
          <ArrowRight className="ml-auto size-4" aria-hidden="true" />
        </Button>
        <p className="account-note">{t('accountNote')}</p>
      </form>
    </Form>
  );
}
