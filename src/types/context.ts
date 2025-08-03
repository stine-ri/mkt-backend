// types/context.ts
export type JwtPayload = {
  id: string;
  email: string;
  role: 'admin' | 'client' | 'service_provider';
  name?: string;    
  avatar?: string | null;
};

export type CustomContext = {
  Variables: {
    user: JwtPayload;
  };
};
