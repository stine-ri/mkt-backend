export interface Request {
  id: number;
  userId: number;
  serviceId?: number;
  productName?: string;
  isService: boolean;
  desiredPrice: number;
  location: string;
  latitude?: number;
  longitude?: number;
  collegeFilterId?: number;
  status: 'pending' | 'accepted' | 'completed' | 'cancelled';
  createdAt: Date;
}

export interface Bid {
  id: number;
  requestId: number;
  providerId: number;
  price: number;
  message?: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: Date;
}

export interface Notification {
  id: number;
  userId: number;
  title: string;
  message: string;
  isRead: boolean;
  type: string;
  relatedId?: number;
  createdAt: Date;
}

export interface Service {
  id: number;
  name: string;
  createdAt: Date;
}

export interface College {
  id: number;
  name: string;
  createdAt: Date;
}