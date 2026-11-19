CREATE TABLE `room_quiz_answers` (
	`room` text NOT NULL,
	`quiz` text NOT NULL,
	`participant` text NOT NULL,
	`name` text NOT NULL,
	`answer` text NOT NULL,
	PRIMARY KEY(`room`, `quiz`, `participant`),
	FOREIGN KEY (`room`,`quiz`) REFERENCES `room_quizzes`(`room`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `room_quizzes` (
	`room` text NOT NULL,
	`id` text NOT NULL,
	`slide` integer NOT NULL,
	`prompt` text NOT NULL,
	`image` text NOT NULL,
	`credit` text,
	PRIMARY KEY(`room`, `id`),
	FOREIGN KEY (`room`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
