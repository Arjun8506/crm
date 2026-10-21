import { Alert, Button, Link, Stack, TextField } from '@mui/material';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link as RouterLink, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import AuthLayout from '../../layouts/AuthLayout';
import { errorMessage } from '../../services/api';
import { useLoginMutation, useSignupMutation } from './authApi';

const password = z.string().min(8, 'At least 8 characters').regex(/[A-Za-z]/, 'Include a letter').regex(/\d/, 'Include a number');
const loginSchema = z.object({ email: z.email('Enter a valid email'), password: z.string().min(1, 'Enter your password') });
const signupSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name'),
  accountName: z.string().trim().min(2, 'Enter your organization name'),
  email: z.email('Enter a valid email'),
  password,
});

function useRedirectIfAuthed() {
  const status = useSelector((s) => s.auth.status);
  const location = useLocation();
  return status === 'authenticated' ? <Navigate to={location.state?.from || '/workspaces'} replace /> : null;
}

export function LoginPage() {
  const redirect = useRedirectIfAuthed();
  const navigate = useNavigate();
  const location = useLocation();
  const [login, { isLoading, error }] = useLoginMutation();
  const { register, handleSubmit, formState: { errors } } = useForm({ resolver: zodResolver(loginSchema) });
  if (redirect) return redirect;

  const onSubmit = async (values) => {
    try {
      await login(values).unwrap();
      navigate(location.state?.from || '/workspaces', { replace: true });
    } catch { /* surfaced through `error` */ }
  };

  return (
    <AuthLayout
      title="Welcome back" subtitle="Sign in to your workspace"
      footer={<>New to OrgCRM? <Link component={RouterLink} to="/signup">Create an account</Link></>}
    >
      <Stack component="form" spacing={2} onSubmit={handleSubmit(onSubmit)} noValidate>
        {error && <Alert severity="error">{errorMessage(error, 'Sign in failed')}</Alert>}
        <TextField label="Email" type="email" autoComplete="email" autoFocus {...register('email')} error={!!errors.email} helperText={errors.email?.message} />
        <TextField label="Password" type="password" autoComplete="current-password" {...register('password')} error={!!errors.password} helperText={errors.password?.message} />
        <Button type="submit" variant="contained" size="large" disabled={isLoading}>{isLoading ? 'Signing in…' : 'Sign in'}</Button>
      </Stack>
    </AuthLayout>
  );
}

export function SignupPage() {
  const redirect = useRedirectIfAuthed();
  const navigate = useNavigate();
  const [signup, { isLoading, error }] = useSignupMutation();
  const { register, handleSubmit, formState: { errors } } = useForm({ resolver: zodResolver(signupSchema) });
  if (redirect) return redirect;

  const onSubmit = async (values) => {
    try {
      await signup(values).unwrap();
      navigate('/workspaces', { replace: true });
    } catch { /* surfaced through `error` */ }
  };

  return (
    <AuthLayout
      title="Create your organization" subtitle="Set up your CRM in under a minute"
      footer={<>Already have an account? <Link component={RouterLink} to="/login">Sign in</Link></>}
    >
      <Stack component="form" spacing={2} onSubmit={handleSubmit(onSubmit)} noValidate>
        {error && <Alert severity="error">{errorMessage(error, 'Sign up failed')}</Alert>}
        <TextField label="Organization name" autoFocus {...register('accountName')} error={!!errors.accountName} helperText={errors.accountName?.message} />
        <TextField label="Your name" autoComplete="name" {...register('name')} error={!!errors.name} helperText={errors.name?.message} />
        <TextField label="Work email" type="email" autoComplete="email" {...register('email')} error={!!errors.email} helperText={errors.email?.message} />
        <TextField label="Password" type="password" autoComplete="new-password" {...register('password')} error={!!errors.password} helperText={errors.password?.message || 'At least 8 characters with a letter and a number'} />
        <Button type="submit" variant="contained" size="large" disabled={isLoading}>{isLoading ? 'Creating…' : 'Create account'}</Button>
      </Stack>
    </AuthLayout>
  );
}
