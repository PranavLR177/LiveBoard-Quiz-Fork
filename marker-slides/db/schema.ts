import { sqliteTable, text, integer, real, primaryKey, foreignKey } from 'drizzle-orm/sqlite-core';
export const rooms = sqliteTable('rooms', { id: text('id').primaryKey(), secret: text('secret').notNull(), title: text('title').notNull(), slides: text('slides').notNull(), studentMarkers: integer('studentMarkers').notNull().default(1), current: integer('current').notNull().default(0), until: integer('until').notNull().default(0), created: integer('created').notNull() });
export const markers = sqliteTable('markers', { id: text('id').primaryKey(), room: text('room').notNull().references(()=>rooms.id), slide: integer('slide').notNull(), x: real('x').notNull(), y: real('y').notNull(), owner: text('owner'), region: text('region'), screenshot: text('screenshot'), kind: text('kind').notNull(), author: text('author').notNull(), body: text('body').notNull(), resolved: integer('resolved').notNull().default(0), created: integer('created').notNull() });
export const replies = sqliteTable('replies', { id: text('id').primaryKey(), marker: text('marker').notNull().references(()=>markers.id), author: text('author').notNull(), body: text('body').notNull(), image: text('image'), source: text('source'), created: integer('created').notNull() });

export const roomQuizzes=sqliteTable('room_quizzes',{
 room:text('room').notNull().references(()=>rooms.id,{onDelete:'cascade'}),
 id:text('id').notNull(),slide:integer('slide').notNull(),prompt:text('prompt').notNull(),image:text('image').notNull()
}, table=>[primaryKey({columns:[table.room,table.id]})]);
export const roomQuizAnswers=sqliteTable('room_quiz_answers',{
 room:text('room').notNull(),quiz:text('quiz').notNull(),participant:text('participant').notNull(),name:text('name').notNull(),answer:text('answer').notNull()
},table=>[primaryKey({columns:[table.room,table.quiz,table.participant]}),foreignKey({columns:[table.room,table.quiz],foreignColumns:[roomQuizzes.room,roomQuizzes.id]}).onDelete('cascade')]);
