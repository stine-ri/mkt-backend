// types/context.ts
export type JwtPayload = {
  id: string;
  email: string;
  role: 'admin' | 'client' | 'service_provider';
};

export type CustomContext = {
  Variables: {
    user: JwtPayload;
  };
};
