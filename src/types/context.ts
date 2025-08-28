// types/context.ts
export type JwtPayload = {
  id: string;
  email: string;
  role: 'admin' | 'client' | 'service_provider'| 'product_seller';
  name?: string;    
  avatar?: string | null;
  providerId?: number| null;
};

export type CustomContext = {
  Variables: {
    user: JwtPayload;
  };
};
