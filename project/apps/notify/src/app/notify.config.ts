import { isEmail } from 'class-validator';

export function validateEnvironment(environment: Record<string, unknown>) {
  const config = { ...environment };
  config['MAILING_PAGE_SIZE'] ??= config['DIGEST_PAGE_SIZE'];
  config['MAILING_SUBJECT'] ??= config['DIGEST_SUBJECT'];
  const required = (
    name: string,
    valid: (value: string) => boolean = Boolean,
  ) => {
    const value = config[name];
    if (typeof value !== 'string' || !value.trim() || !valid(value))
      throw new Error(`Некорректная или незаданная переменная ${name}`);
    return value;
  };
  const integer = (name: string, min: number, max: number) => {
    const value = Number(required(name, (raw) => /^\d+$/.test(raw)));
    if (value < min || value > max)
      throw new Error(`Некорректная переменная ${name}`);
    config[name] = value;
    return value;
  };
  const url = (name: string, protocols: string[]) => {
    const value = new URL(required(name, (raw) => URL.canParse(raw)));
    if (!protocols.includes(value.protocol) || !value.hostname)
      throw new Error(`Некорректная переменная ${name}`);
    return value;
  };

  integer('PORT', 1, 65535);
  integer('SMTP_PORT', 1, 65535);
  integer('NOTIFY_BATCH_SIZE', 1, 1000);
  integer('RABBITMQ_PREFETCH', 1, 100);
  integer('RABBITMQ_TIMEOUT_MS', 1000, 60000);
  integer('MAILING_PAGE_SIZE', 1, 1000);
  const timeout = integer('SMTP_TIMEOUT_MS', 1000, 60000);
  const lease = integer('NOTIFY_LEASE_MS', 10000, 3600000);
  if (lease < timeout * 5)
    throw new Error(
      'NOTIFY_LEASE_MS должен быть не меньше 5 * SMTP_TIMEOUT_MS',
    );

  url('MONGO_URI', ['mongodb:', 'mongodb+srv:']);
  url('RABBITMQ_URL', ['amqp:', 'amqps:']);
  required('RABBITMQ_QUEUE');
  required('RABBITMQ_USER_QUEUE');
  required('RABBITMQ_BLOG_QUEUE');
  const publicUrl = url('BLOG_PUBLIC_URL', ['http:', 'https:']);
  if (publicUrl.search || publicUrl.hash)
    throw new Error('BLOG_PUBLIC_URL должен быть HTTP(S) URL без query и hash');
  required(
    'MAILING_SUBJECT',
    (value) => value.length <= 200 && !/[\r\n]/.test(value),
  );
  required('SMTP_HOST');
  required('SMTP_FROM', isEmail);
  config['SMTP_SECURE'] =
    required('SMTP_SECURE', (value) => ['true', 'false'].includes(value)) ===
    'true';
  if (Boolean(config['SMTP_USER']) !== Boolean(config['SMTP_PASSWORD']))
    throw new Error('SMTP_USER и SMTP_PASSWORD задаются вместе');
  required('NOTIFY_HTTP_TOKEN', (value) => /^\S{32,}$/.test(value));
  required('JWT_SECRET', (value) => Buffer.byteLength(value) >= 32);
  return config;
}
