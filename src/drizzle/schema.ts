import {
    pgTable,
    serial,
    text,
    varchar,
    integer,
    primaryKey,
    decimal,
    boolean,
    timestamp,
    date,
    time,
     jsonb,
     index,
     numeric,
     pgEnum
  } from "drizzle-orm/pg-core";
  import { relations } from "drizzle-orm";
  
  // Enums
export const roleEnum = pgEnum("role", ["admin", "service_provider", "client"]);
  
// Support ticket status enum
export const ticketStatusEnum = pgEnum('ticket_status', ['pending', 'in_progress', 'resolved']);

// Support ticket priority enum
export const ticketPriorityEnum = pgEnum('ticket_priority', ['low', 'medium', 'high']);

// Support ticket category enum
export const ticketCategoryEnum = pgEnum('ticket_category', [
  'payment', 
  'technical', 
  'account', 
  'listing', 
  'dispute', 
  'verification', 
  'other'
]);
//testimonials enum 
export const testimonialStatusEnum = pgEnum('testimonial_status', ['pending', 'approved', 'rejected']);
  // Users Table
  export const users = pgTable("users", {
    id: serial("user_id").primaryKey(),
    full_name: text("full_name").notNull(),
    email: varchar("email", { length: 255 }).unique().notNull(),
    contact_phone: varchar("contact_phone", { length: 20 }),
    address: text("address"),
  avatar: varchar('avatar', { length: 255 }), 
    role: roleEnum("role").default("client").notNull(),
    created_at: timestamp("created_at").defaultNow(),
    updated_at: timestamp("updated_at").defaultNow(),
  });
  
  // Authentication Table
export const Authentication = pgTable("authentication", {
    auth_id: serial("auth_id").primaryKey(),
    user_id: integer("user_id").notNull().references(() => users.id,{onDelete:"cascade"}),
    password: varchar("password"),
    email: varchar("email", { length: 255 }).unique(),
    role: roleEnum("role").default("client"),
    created_at: timestamp("created_at").defaultNow(),
    updated_at: timestamp("updated_at").defaultNow(),
});

export const colleges = pgTable('colleges', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  location: varchar('location', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow(),
});

export const services = pgTable('services', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  category: varchar('category', { length: 100 }),
  description: text('description'),
   createdAt: timestamp('created_at').defaultNow(),
});

export const providers = pgTable('providers', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  firstName: varchar('first_name', { length: 100 }).notNull(),
  lastName: varchar('last_name', { length: 100 }).notNull(),
  phoneNumber: varchar('phone_number', { length: 20 }).notNull(),
  collegeId: integer('college_id').references(() => colleges.id),
  latitude: varchar('latitude', { length: 50 }),
  longitude: varchar('longitude', { length: 50 }),
  address: text('address'),
  bio: text('bio'),
  isProfileComplete: boolean('is_profile_complete').default(false),
  rating: integer('rating'),
  completedRequests: integer('completed_requests').default(0),
  profileImageUrl: varchar('profile_image_url', { length: 500 }),
  status: varchar('status', { length: 50 }).default('active'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const providerServices = pgTable('provider_services', {
  providerId: integer('provider_id').notNull().references(() => providers.id),
  serviceId: integer('service_id').notNull().references(() => services.id),
}, (t) => ({
  pk: primaryKey(t.providerId, t.serviceId),
}));

// Requests table - defined without circular reference first
export const requests = pgTable('requests', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  serviceId: integer('service_id').references(() => services.id),
  productName: varchar('product_name', { length: 255 }),
  isService: boolean('is_service').notNull(),
  description: text('description'),
  desiredPrice: integer('desired_price').notNull(),
  location: varchar('location', { length: 255 }).notNull(),
  collegeFilterId: integer('college_filter_id').references(() => colleges.id),
  status: varchar('status', { enum: ['open', 'closed', 'pending'] }).default('open'),
  allowInterests: boolean('allow_interests').default(true),
  allowBids: boolean('allow_bids').default(true),
  // Store accepted bid ID without foreign key constraint to avoid circular dependency
  accepted_bid_id: integer('accepted_bid_id'),
  
  createdAt: timestamp('created_at').defaultNow(),
});

// Bids table
export const bids = pgTable('bids', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  requestId: integer('request_id').notNull().references(() => requests.id),
  providerId: integer('provider_id').references(() => providers.id),
  price: integer('price').notNull(),
  message: text('message'),
  isGraduateOfRequestedCollege: boolean('is_graduate_of_requested_college').notNull(),
  status: varchar('status', { enum: ['pending', 'accepted', 'rejected'] }).default('pending'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  type: varchar('type', { length: 50 }).notNull(),
  message: text('message').notNull(),
  relatedEntityId: integer('related_entity_id'),
  requestId: integer('request_id'),
  isRead: boolean('is_read').default(false),
  createdAt: timestamp('created_at').defaultNow(),
});
export const interests = pgTable('interests', {
  id: serial('id').primaryKey(),
  requestId: integer('request_id')
    .references(() => requests.id, { onDelete: 'cascade' }),
  providerId: integer('provider_id')
    .references(() => providers.id, { onDelete: 'cascade' }),
      chatRoomId: integer('chat_room_id')
    .references(() => chatRooms.id),
  createdAt: timestamp('created_at').defaultNow(),
  message: text('message'),
  isShortlisted: boolean('is_shortlisted').default(false),
  status: text('status').default('pending').notNull(),
});

export const chatRooms = pgTable('chat_rooms', {
  id: serial('id').primaryKey(),
  requestId: integer('request_id').notNull().references(() => requests.id),
  clientId: integer('client_id').notNull().references(() => users.id),
  providerId: integer('provider_id').notNull().references(() => users.id),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  // Add the indexes here
  clientIdIdx: index('idx_chat_rooms_client_id').on(table.clientId),
  providerIdIdx: index('idx_chat_rooms_provider_id').on(table.providerId),
}));


export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  chatRoomId: integer('chat_room_id').notNull().references(() => chatRooms.id),
  senderId: integer('sender_id').notNull().references(() => users.id),
  content: text('content').notNull(),
  isSystem: boolean('is_system').notNull().default(false),
  read: boolean('read').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow()
}, (table) => ({
  // Add the indexes here
  chatRoomIdIdx: index('idx_messages_chat_room_id').on(table.chatRoomId),
  senderIdIdx: index('idx_messages_sender_id').on(table.senderId),
}));

export const paymentAgreements = pgTable('payment_agreements', {
  id: serial('id').primaryKey(),
  chatRoomId: integer('chat_room_id').notNull().references(() => chatRooms.id),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  paymentMethod: text('payment_method').notNull(),
  terms: text('terms'),
  status: text('status').notNull().default('pending'), // pending, accepted, completed
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
});

export const pastWorks = pgTable('past_works', {
  id: serial('id').primaryKey(),
  providerId: integer('provider_id').notNull().references(() => providers.id),
  imageUrl: varchar('image_url', { length: 500 }).notNull(),
  description: text('description').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Product Status Enum
export const productStatusEnum = pgEnum('product_status', ['draft', 'published', 'archived']);

// Sale Status Enum
export const saleStatusEnum = pgEnum('sale_status', ['pending', 'completed', 'cancelled']);

// Products Table
export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  providerId: integer('provider_id').notNull().references(() => providers.id),
  name: text('name').notNull(),
  description: text('description').notNull(),
  price: numeric('price', { precision: 12, scale: 2 }).notNull(), // Using numeric for precise decimal storage
  categoryId: integer('category_id').references(() => categories.id), 
  stock: integer('stock'),
  status: productStatusEnum('status').notNull().default('draft'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Product Images Table
export const productImages = pgTable('product_images', {
  id: serial('id').primaryKey(),
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  publicId: text('public_id'),
  url: text('url').notNull(),
  isPrimary: boolean('is_primary').default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// Product Sales Table
export const productSales = pgTable('product_sales', {
  id: serial('id').primaryKey(),
  productId: integer('product_id').notNull().references(() => products.id),
  providerId: integer('provider_id').notNull().references(() => providers.id),
  customerId: integer('customer_id').notNull().references(() => users.id),
  quantity: integer('quantity').notNull(),
  totalPrice: numeric('total_price', { precision: 12, scale: 2 }).notNull(),
  status: saleStatusEnum('status').notNull().default('pending'),
  paymentMethod: text('payment_method'),
  transactionId: text('transaction_id'),
  shippingAddress: text('shipping_address'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
// Support tickets table
export const supportTickets = pgTable('support_tickets', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  title: varchar('title', { length: 255 }).notNull(),
  issue: text('issue').notNull(),
  category: ticketCategoryEnum('category').notNull(),
  priority: ticketPriorityEnum('priority').default('medium').notNull(),
  status: ticketStatusEnum('status').default('pending').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Ticket responses table
export const ticketResponses = pgTable('ticket_responses', {
  id: serial('id').primaryKey(),
  ticketId: integer('ticket_id').notNull().references(() => supportTickets.id),
  userId: integer('user_id').notNull().references(() => users.id),
  message: text('message').notNull(),
  isAdminResponse: boolean('is_admin_response').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});
//  testimonials table 
export const testimonials = pgTable('testimonials', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
  requestId: integer('request_id').references(() => requests.id, { onDelete: 'cascade' }).notNull(),
  providerId: integer('provider_id').references(() => providers.id, { onDelete: 'set null' }),
  
  // User details (cached for consistency)
  userName: varchar('user_name', { length: 255 }).notNull(),
  userEmail: varchar('user_email', { length: 255 }),
  userRole: roleEnum('user_role').notNull().default('client'),
  userAvatarUrl: varchar('user_avatar_url', { length: 500 }),
  
  // Review content
  rating: integer('rating').notNull(), // 1-5 stars
  reviewText: text('review_text').notNull(),
  serviceCategory: varchar('service_category', { length: 255 }),
  serviceName: varchar('service_name', { length: 255 }),
  
  // Moderation
  status: testimonialStatusEnum('status').default('pending').notNull(),
  isPublic: boolean('is_public').default(true),
  moderatedBy: integer('moderated_by').references(() => users.id),
  moderationNotes: text('moderation_notes'),
  
  // Timestamps
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  // Add indexes for performance
  userIdIdx: index('idx_testimonials_user_id').on(table.userId),
  requestIdIdx: index('idx_testimonials_request_id').on(table.requestId),
  statusPublicIdx: index('idx_testimonials_status_public').on(table.status, table.isPublic),
  createdAtIdx: index('idx_testimonials_created_at').on(table.createdAt),
}));

//  categories table
export const categories = pgTable('categories', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// categories relations
export const categoriesRelations = relations(categories, ({ many }) => ({
  products: many(products),
}));

// Add relations
export const supportTicketsRelations = relations(supportTickets, ({ many, one }) => ({
  user: one(users, {
    fields: [supportTickets.userId],
    references: [users.id],
  }),
  responses: many(ticketResponses),
}));

export const ticketResponsesRelations = relations(ticketResponses, ({ one }) => ({
  ticket: one(supportTickets, {
    fields: [ticketResponses.ticketId],
    references: [supportTickets.id],
  }),
  user: one(users, {
    fields: [ticketResponses.userId],
    references: [users.id],
  }),
}));

// Product Relations
export const productsRelations = relations(products, ({ many, one }) => ({
  provider: one(providers, {
    fields: [products.providerId],
    references: [providers.id],
  }),
   category: one(categories, { 
    fields: [products.categoryId],
    references: [categories.id],
  }),
  images: many(productImages),
  sales: many(productSales),
}));

// Product Images Relations
export const productImagesRelations = relations(productImages, ({ one }) => ({
  product: one(products, {
    fields: [productImages.productId],
    references: [products.id],
  }),
}));

// Product Sales Relations
export const productSalesRelations = relations(productSales, ({ one }) => ({
  product: one(products, {
    fields: [productSales.productId],
    references: [products.id],
  }),
  provider: one(providers, {
    fields: [productSales.providerId],
    references: [providers.id],
  }),
  customer: one(users, {
    fields: [productSales.customerId],
    references: [users.id],
  }),
}));


// Define all relations
export const authenticationRelations = relations(Authentication, ({ one }) => ({
    user: one(users, {
        fields: [Authentication.user_id],
        references: [users.id],
    }),
}));
export const userRelations = relations(users, ({ many }) => ({
  authentication: many(Authentication),
  providers: many(providers),
  requests: many(requests),
  bids: many(bids),
    sentMessages: many(messages, { relationName: 'messageSender' }),
  clientChats: many(chatRooms, { relationName: 'chatRoomClient' }),
  providerChats: many(chatRooms, { relationName: 'chatRoomProvider' }),
  testimonials: many(testimonials),
  moderatedTestimonials: many(testimonials, { relationName: 'moderatedTestimonials' }),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  chatRoom: one(chatRooms, {
    fields: [messages.chatRoomId],
    references: [chatRooms.id],
  }),
  sender: one(users, {
    fields: [messages.senderId],
    references: [users.id],
    relationName: 'messageSender'
  }),
}));


export const chatRoomsRelations = relations(chatRooms, ({ many, one }) => ({
  messages: many(messages),
  request: one(requests, {
    fields: [chatRooms.requestId],
    references: [requests.id],
  }),
  client: one(users, {
    fields: [chatRooms.clientId],
    references: [users.id],
    relationName: 'chat_client' // Add relation name
  }),
  provider: one(users, {
    fields: [chatRooms.providerId],
    references: [users.id],
    relationName: 'chat_provider' // Add relation name
  }),
}));

export const providerRelations = relations(providers, ({ many, one }) => ({
  user: one(users, {
    fields: [providers.userId],
    references: [users.id],
  }),
  college: one(colleges, {
    fields: [providers.collegeId],
    references: [colleges.id],
  }),
  services: many(providerServices),
  bids: many(bids),
  interests: many(interests),
  pastWorks: many(pastWorks), 
  testimonials: many(testimonials),
}));

export const collegeRelations = relations(colleges, ({ many }) => ({
  providers: many(providers),
  requests: many(requests),
}));

export const serviceRelations = relations(services, ({ many }) => ({
  providerServices: many(providerServices),
  requests: many(requests),
}));

export const providerServiceRelations = relations(providerServices, ({ one }) => ({
  provider: one(providers, {
    fields: [providerServices.providerId],
    references: [providers.id],
  }),
  service: one(services, {
    fields: [providerServices.serviceId],
    references: [services.id],
  }),
}));

export const requestsRelations = relations(requests, ({ one, many }) => ({
  user: one(users, {
    fields: [requests.userId],
    references: [users.id],
  }),
  service: one(services, {
    fields: [requests.serviceId],
    references: [services.id],
  }),
  college: one(colleges, {
    fields: [requests.collegeFilterId],
    references: [colleges.id],
  }),
  interests: many(interests),
  bids: many(bids),
  testimonials: many(testimonials),
  // Handle the circular dependency through relations
  acceptedBid: one(bids, {
    fields: [requests.accepted_bid_id],
    references: [bids.id],
  }),
}));

export const bidsRelations = relations(bids, ({ one }) => ({
  user: one(users, {
    fields: [bids.userId],
    references: [users.id],
  }),
  request: one(requests, {
    fields: [bids.requestId],
    references: [requests.id],
  }),
  provider: one(providers, {
    fields: [bids.providerId],
    references: [providers.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
}));

// Define the Interest type first
export type TInterest = typeof interests.$inferSelect;

export const interestsRelations = relations(interests, ({ one }) => ({
  request: one(requests, {
    fields: [interests.requestId],
    references: [requests.id],
  }),
  provider: one(providers, {
    fields: [interests.providerId],
    references: [providers.id],
  }),
  chatRoom: one(chatRooms, {
    fields: [interests.chatRoomId],
    references: [chatRooms.id],
  }),
}));

export const pastWorksRelations = relations(pastWorks, ({ one }) => ({
  provider: one(providers, {
    fields: [pastWorks.providerId],
    references: [providers.id],
  }),
}));

// testimonials relations 
export const testimonialsRelations = relations(testimonials, ({ one }) => ({
  user: one(users, {
    fields: [testimonials.userId],
    references: [users.id],
  }),
  request: one(requests, {
    fields: [testimonials.requestId],
    references: [requests.id],
  }),
  provider: one(providers, {
    fields: [testimonials.providerId],
    references: [providers.id],
  }),
  moderator: one(users, {
    fields: [testimonials.moderatedBy],
    references: [users.id],
    relationName: 'moderatedTestimonials'
  }),
}));
// Export types for TypeScript support
export type TIUsers = typeof users.$inferInsert;
export type TSUsers = typeof users.$inferSelect;

export type TIAuthentication = typeof Authentication.$inferInsert;
export type TSAuthentication = typeof Authentication.$inferSelect;

export type TIProviders = typeof providers.$inferInsert;
export type TSProviders = typeof providers.$inferSelect;

export type TIRequests = typeof requests.$inferInsert;
export type TSRequests = typeof requests.$inferSelect;

export type TIInterests = typeof interests .$inferInsert;
export type TSInterests = typeof interests .$inferSelect;

export type TIBids = typeof bids.$inferInsert;
export type TSBids = typeof bids.$inferSelect;

export type TIColleges = typeof colleges.$inferInsert;
export type TSColleges = typeof colleges.$inferSelect;

export type TIServices = typeof services.$inferInsert;
export type TSServices = typeof services.$inferSelect;

export type TINotifications = typeof notifications.$inferInsert;
export type TSNotifications = typeof notifications.$inferSelect;

export type TIProducts = typeof products.$inferInsert;
export type TSProducts = typeof products.$inferSelect;

export type TIProductImages = typeof productImages.$inferInsert;
export type TSProductImages = typeof productImages.$inferSelect;

export type TIProductSales = typeof productSales.$inferInsert;
export type TSProductSales = typeof productSales.$inferSelect;


export type TISupportTicket = typeof supportTickets.$inferInsert;
export type TSSupportTicket = typeof supportTickets.$inferSelect;

export type TITicketResponse = typeof ticketResponses.$inferInsert;
export type TSTicketResponse = typeof ticketResponses.$inferSelect;

export type TITestimonials = typeof testimonials.$inferInsert;
export type TSTestimonials = typeof testimonials.$inferSelect;

// Extend the base request type to include relations
export type TSRequestsWithRelations = TSRequests & {
  // Computed fields
  budget?: number;
  title?: string;
  category?: string;
  serviceName?: string;
  created_at?: Date | null;
  
  // Relations
  service?: TSServices | null;
  college?: TSColleges | null;
  bids?: TSBids[];
  interests?: (TSInterests & {
    provider?: TSProviders & {
      user?: TSUsers | null;
    } | null;
  })[];
};

export type TSTestimonialsWithRelations = TSTestimonials & {
  user?: TSUsers | null;
  request?: TSRequests | null;
  provider?: TSProviders | null;
  moderator?: TSUsers | null;
};