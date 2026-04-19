--
-- PostgreSQL database dump
--

\restrict DzthRAASt6rMab35XuMOMnfc8RT4vLhxAMn6l9ogyxhTFvlQvMBl7KjoINGVDby

-- Dumped from database version 16.13
-- Dumped by pg_dump version 16.13

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

ALTER TABLE IF EXISTS ONLY public.shows DROP CONSTRAINT IF EXISTS shows_venue_id_fkey;
ALTER TABLE IF EXISTS ONLY public.show_entries DROP CONSTRAINT IF EXISTS show_entries_show_id_fkey;
ALTER TABLE IF EXISTS ONLY public.show_entries DROP CONSTRAINT IF EXISTS show_entries_rider_id_fkey;
ALTER TABLE IF EXISTS ONLY public.rings DROP CONSTRAINT IF EXISTS rings_show_id_fkey;
ALTER TABLE IF EXISTS ONLY public.exhibitors DROP CONSTRAINT IF EXISTS riders_user_id_fkey;
ALTER TABLE IF EXISTS ONLY public.exhibitor_horses DROP CONSTRAINT IF EXISTS rider_horses_rider_id_fkey;
ALTER TABLE IF EXISTS ONLY public.exhibitor_horses DROP CONSTRAINT IF EXISTS rider_horses_horse_id_fkey;
ALTER TABLE IF EXISTS ONLY public.results DROP CONSTRAINT IF EXISTS results_entry_id_fkey;
ALTER TABLE IF EXISTS ONLY public.results DROP CONSTRAINT IF EXISTS results_class_id_fkey;
ALTER TABLE IF EXISTS ONLY public.result_audit DROP CONSTRAINT IF EXISTS result_audit_result_id_fkey;
ALTER TABLE IF EXISTS ONLY public.result_audit DROP CONSTRAINT IF EXISTS result_audit_changed_by_fkey;
ALTER TABLE IF EXISTS ONLY public.entries DROP CONSTRAINT IF EXISTS entries_rider_id_fkey;
ALTER TABLE IF EXISTS ONLY public.entries DROP CONSTRAINT IF EXISTS entries_horse_id_fkey;
ALTER TABLE IF EXISTS ONLY public.entries DROP CONSTRAINT IF EXISTS entries_class_id_fkey;
ALTER TABLE IF EXISTS ONLY public.divisions DROP CONSTRAINT IF EXISTS divisions_show_id_fkey;
ALTER TABLE IF EXISTS ONLY public.classes DROP CONSTRAINT IF EXISTS classes_show_id_fkey;
ALTER TABLE IF EXISTS ONLY public.classes DROP CONSTRAINT IF EXISTS classes_ring_id_fkey;
ALTER TABLE IF EXISTS ONLY public.classes DROP CONSTRAINT IF EXISTS classes_division_id_fkey;
DROP INDEX IF EXISTS public.unique_back_number_per_class;
ALTER TABLE IF EXISTS ONLY public.venues DROP CONSTRAINT IF EXISTS venues_pkey;
ALTER TABLE IF EXISTS ONLY public.users DROP CONSTRAINT IF EXISTS users_pkey;
ALTER TABLE IF EXISTS ONLY public.users DROP CONSTRAINT IF EXISTS users_email_key;
ALTER TABLE IF EXISTS ONLY public.shows DROP CONSTRAINT IF EXISTS shows_pkey;
ALTER TABLE IF EXISTS ONLY public.show_entries DROP CONSTRAINT IF EXISTS show_entries_show_id_rider_id_key;
ALTER TABLE IF EXISTS ONLY public.show_entries DROP CONSTRAINT IF EXISTS show_entries_show_id_back_number_key;
ALTER TABLE IF EXISTS ONLY public.show_entries DROP CONSTRAINT IF EXISTS show_entries_pkey;
ALTER TABLE IF EXISTS ONLY public.rings DROP CONSTRAINT IF EXISTS rings_pkey;
ALTER TABLE IF EXISTS ONLY public.exhibitors DROP CONSTRAINT IF EXISTS riders_pkey;
ALTER TABLE IF EXISTS ONLY public.exhibitor_horses DROP CONSTRAINT IF EXISTS rider_horses_rider_id_horse_id_key;
ALTER TABLE IF EXISTS ONLY public.exhibitor_horses DROP CONSTRAINT IF EXISTS rider_horses_pkey;
ALTER TABLE IF EXISTS ONLY public.results DROP CONSTRAINT IF EXISTS results_pkey;
ALTER TABLE IF EXISTS ONLY public.results DROP CONSTRAINT IF EXISTS results_class_id_place_entry_id_key;
ALTER TABLE IF EXISTS ONLY public.result_audit DROP CONSTRAINT IF EXISTS result_audit_pkey;
ALTER TABLE IF EXISTS ONLY public.horses DROP CONSTRAINT IF EXISTS horses_pkey;
ALTER TABLE IF EXISTS ONLY public.entries DROP CONSTRAINT IF EXISTS entries_pkey;
ALTER TABLE IF EXISTS ONLY public.entries DROP CONSTRAINT IF EXISTS entries_class_id_rider_id_horse_id_key;
ALTER TABLE IF EXISTS ONLY public.divisions DROP CONSTRAINT IF EXISTS divisions_pkey;
ALTER TABLE IF EXISTS ONLY public.classes DROP CONSTRAINT IF EXISTS classes_pkey;
DROP TABLE IF EXISTS public.venues;
DROP TABLE IF EXISTS public.users;
DROP TABLE IF EXISTS public.shows;
DROP TABLE IF EXISTS public.show_entries;
DROP TABLE IF EXISTS public.rings;
DROP TABLE IF EXISTS public.results;
DROP TABLE IF EXISTS public.result_audit;
DROP TABLE IF EXISTS public.horses;
DROP TABLE IF EXISTS public.exhibitors;
DROP TABLE IF EXISTS public.exhibitor_horses;
DROP TABLE IF EXISTS public.entries;
DROP TABLE IF EXISTS public.divisions;
DROP TABLE IF EXISTS public.classes;
SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: classes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.classes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    show_id uuid NOT NULL,
    ring_id uuid,
    division_id uuid,
    class_number text NOT NULL,
    class_name text NOT NULL,
    class_date date NOT NULL,
    status text DEFAULT 'OPEN'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.classes OWNER TO postgres;

--
-- Name: divisions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.divisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    show_id uuid NOT NULL,
    name text NOT NULL
);


ALTER TABLE public.divisions OWNER TO postgres;

--
-- Name: entries; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    class_id uuid NOT NULL,
    exhibitor_id uuid NOT NULL,
    horse_id uuid NOT NULL,
    back_number integer,
    status text DEFAULT 'ENTERED'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.entries OWNER TO postgres;

--
-- Name: exhibitor_horses; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.exhibitor_horses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    exhibitor_id uuid NOT NULL,
    horse_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.exhibitor_horses OWNER TO postgres;

--
-- Name: exhibitors; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.exhibitors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    full_name text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    user_id uuid
);


ALTER TABLE public.exhibitors OWNER TO postgres;

--
-- Name: horses; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.horses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    owner_name text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.horses OWNER TO postgres;

--
-- Name: result_audit; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.result_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    result_id uuid NOT NULL,
    changed_by uuid,
    old_place integer,
    new_place integer,
    changed_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.result_audit OWNER TO postgres;

--
-- Name: results; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    class_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    place integer NOT NULL,
    is_tie boolean DEFAULT false,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT results_place_check CHECK ((place > 0))
);


ALTER TABLE public.results OWNER TO postgres;

--
-- Name: rings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    show_id uuid NOT NULL,
    name text NOT NULL
);


ALTER TABLE public.rings OWNER TO postgres;

--
-- Name: show_entries; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.show_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    show_id uuid NOT NULL,
    exhibitor_id uuid NOT NULL,
    back_number integer,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.show_entries OWNER TO postgres;

--
-- Name: shows; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.shows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    venue text,
    start_date date NOT NULL,
    end_date date NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    status text DEFAULT 'DRAFT'::text NOT NULL,
    venue_id uuid
);


ALTER TABLE public.shows OWNER TO postgres;

--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    role text NOT NULL,
    full_name text NOT NULL,
    email text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    hashed_password text
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: venues; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.venues (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    address text,
    city text,
    state text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.venues OWNER TO postgres;

--
-- Data for Name: classes; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.classes (id, show_id, ring_id, division_id, class_number, class_name, class_date, status, created_at) FROM stdin;
9a95019b-8fbb-4b57-9928-919285b47822	1fcf1f7d-82da-4582-be3c-9c9dd3e3cdd0	\N	\N	101	Western Pleasure Open	2026-04-19	OPEN	2026-04-12 13:15:57.922703+00
848f4047-1ef8-45c4-8ede-0915f32a71ee	1fcf1f7d-82da-4582-be3c-9c9dd3e3cdd0	\N	\N	102	Ranch Riding Open	2026-04-20	OPEN	2026-04-13 20:36:28.203889+00
a30e4a2d-f13b-4435-99bf-47cd124225d1	000b12cd-7884-44ed-8f4b-69d759104638	\N	\N	101	Dan's Test Class	2026-04-20	OPEN	2026-04-19 13:01:07.657559+00
\.


--
-- Data for Name: divisions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.divisions (id, show_id, name) FROM stdin;
\.


--
-- Data for Name: entries; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.entries (id, class_id, exhibitor_id, horse_id, back_number, status, created_at) FROM stdin;
74c996c0-e3f3-41a7-b571-eaf3af3c4fe0	9a95019b-8fbb-4b57-9928-919285b47822	7e6f7817-3516-44cf-8556-4ff547f1ab13	5e56a21a-2cc7-4c67-9dc2-5e98e8056a10	101	ENTERED	2026-04-12 13:23:07.255146+00
89777314-d754-4827-9f2a-c25484fe735b	848f4047-1ef8-45c4-8ede-0915f32a71ee	e5362e99-56ca-47d8-b47b-0275013552c1	f8e8eea9-0c05-49f8-b166-550c14655532	101	ENTERED	2026-04-13 20:37:59.262557+00
3bdc9186-eaaf-4fc2-9c77-0d8c92338c7e	848f4047-1ef8-45c4-8ede-0915f32a71ee	7e6f7817-3516-44cf-8556-4ff547f1ab13	5e56a21a-2cc7-4c67-9dc2-5e98e8056a10	102	ENTERED	2026-04-14 03:07:36.01716+00
b548562f-2e61-43d9-965b-f51daf53e2db	9a95019b-8fbb-4b57-9928-919285b47822	e5362e99-56ca-47d8-b47b-0275013552c1	f8e8eea9-0c05-49f8-b166-550c14655532	100	ENTERED	2026-04-14 13:06:53.593967+00
57718b4a-6720-4f00-8af5-c85c4b6976ba	9a95019b-8fbb-4b57-9928-919285b47822	e52ee0c6-38d4-4f51-9d48-e895214f7913	600c4eaf-27c8-4b19-92c4-01019a21389b	99	ENTERED	2026-04-15 04:32:36.453689+00
184539e1-3d8b-4d92-9e38-77facc62146b	9a95019b-8fbb-4b57-9928-919285b47822	878b7f85-3174-4f7f-810e-650242828b57	d5d5715a-95d9-4933-ae7c-4007109597d3	1	ENTERED	2026-04-15 04:32:47.667364+00
b1010410-eecd-4728-bd6a-15a19c1f1c2d	a30e4a2d-f13b-4435-99bf-47cd124225d1	e52ee0c6-38d4-4f51-9d48-e895214f7913	600c4eaf-27c8-4b19-92c4-01019a21389b	99	ENTERED	2026-04-19 13:01:28.19336+00
\.


--
-- Data for Name: exhibitor_horses; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.exhibitor_horses (id, exhibitor_id, horse_id, created_at) FROM stdin;
1459f21b-bb66-4ed3-9d19-abc35452fde2	e52ee0c6-38d4-4f51-9d48-e895214f7913	600c4eaf-27c8-4b19-92c4-01019a21389b	2026-04-15 04:29:13.248473+00
f6b4bcd3-88ae-4b06-8b41-f9ffe60e9f9a	878b7f85-3174-4f7f-810e-650242828b57	d5d5715a-95d9-4933-ae7c-4007109597d3	2026-04-15 04:31:24.233483+00
\.


--
-- Data for Name: exhibitors; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.exhibitors (id, full_name, created_at, user_id) FROM stdin;
7e6f7817-3516-44cf-8556-4ff547f1ab13	Jane Smith	2026-04-12 13:19:07.720609+00	\N
e5362e99-56ca-47d8-b47b-0275013552c1	Kristen Huber	2026-04-13 20:37:36.121315+00	d283c19e-4503-418c-8628-d4406410acc8
e52ee0c6-38d4-4f51-9d48-e895214f7913	Dan Huber	2026-04-14 13:21:23.776156+00	\N
878b7f85-3174-4f7f-810e-650242828b57	Joe Mamma	2026-04-15 04:31:13.736684+00	\N
\.


--
-- Data for Name: horses; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.horses (id, name, owner_name, created_at) FROM stdin;
5e56a21a-2cc7-4c67-9dc2-5e98e8056a10	Zip	Jane Smith	2026-04-12 13:18:41.525173+00
f8e8eea9-0c05-49f8-b166-550c14655532	Rocky	Kristen Huber	2026-04-13 20:37:16.985509+00
600c4eaf-27c8-4b19-92c4-01019a21389b	Skol	Bob Smith	2026-04-14 13:21:25.828929+00
03210b41-c0fa-49d6-9c85-f7a1dc8b2467	Skol	Dan Huber	2026-04-15 04:23:56.796304+00
a1cf3f07-f8a7-4a40-863c-d39c298b82df	Skol	Dan Huber	2026-04-15 04:28:54.816053+00
d5d5715a-95d9-4933-ae7c-4007109597d3	Scenic	Krissy	2026-04-15 04:30:58.59901+00
\.


--
-- Data for Name: result_audit; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.result_audit (id, result_id, changed_by, old_place, new_place, changed_at) FROM stdin;
dac585bf-6c06-4f46-92c7-e9e55cfc8201	726efabc-f1c6-4385-8dd3-4cec4fa1f18a	\N	1	2	2026-04-14 12:58:19.631103+00
759bff3a-47db-4410-bd46-e92a7fdca08c	726efabc-f1c6-4385-8dd3-4cec4fa1f18a	\N	2	1	2026-04-14 12:58:31.74468+00
36dbd9fe-0415-477b-99d5-06bc038f169a	726efabc-f1c6-4385-8dd3-4cec4fa1f18a	\N	1	2	2026-04-14 13:01:10.195806+00
2549ef40-0159-4a91-91d1-fcef3a5e19e3	726efabc-f1c6-4385-8dd3-4cec4fa1f18a	\N	2	1	2026-04-14 13:01:14.73817+00
c2138405-ccc5-478e-8faf-b7df2b33e2a0	726efabc-f1c6-4385-8dd3-4cec4fa1f18a	\N	1	2	2026-04-14 13:03:20.143098+00
\.


--
-- Data for Name: results; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.results (id, class_id, entry_id, place, is_tie, notes, created_at) FROM stdin;
1706a186-16aa-41c1-ae41-4fd067d3985b	848f4047-1ef8-45c4-8ede-0915f32a71ee	89777314-d754-4827-9f2a-c25484fe735b	1	f	\N	2026-04-14 02:51:23.132181+00
726efabc-f1c6-4385-8dd3-4cec4fa1f18a	848f4047-1ef8-45c4-8ede-0915f32a71ee	3bdc9186-eaaf-4fc2-9c77-0d8c92338c7e	2	f	\N	2026-04-14 03:09:35.26056+00
fdb960b8-0abb-4b54-badb-dc025d974c81	9a95019b-8fbb-4b57-9928-919285b47822	184539e1-3d8b-4d92-9e38-77facc62146b	4	f	\N	2026-04-15 04:33:10.669073+00
1776f591-1e6d-4e04-8cc8-aefc10e8136f	9a95019b-8fbb-4b57-9928-919285b47822	57718b4a-6720-4f00-8af5-c85c4b6976ba	3	f	\N	2026-04-15 04:33:10.669073+00
0aaa184a-8693-4217-bcf2-215e58108ec0	9a95019b-8fbb-4b57-9928-919285b47822	b548562f-2e61-43d9-965b-f51daf53e2db	1	f	\N	2026-04-15 04:33:10.669073+00
20d362d2-616f-4bd0-969d-ae5583520f71	9a95019b-8fbb-4b57-9928-919285b47822	74c996c0-e3f3-41a7-b571-eaf3af3c4fe0	2	f	\N	2026-04-15 04:33:10.669073+00
\.


--
-- Data for Name: rings; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.rings (id, show_id, name) FROM stdin;
\.


--
-- Data for Name: show_entries; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.show_entries (id, show_id, exhibitor_id, back_number, created_at) FROM stdin;
a7fb34ef-1bd0-49d0-a7a5-9751c77b907f	1fcf1f7d-82da-4582-be3c-9c9dd3e3cdd0	7e6f7817-3516-44cf-8556-4ff547f1ab13	1	2026-04-14 03:08:50.001306+00
a65b444a-2070-4dcd-b1d7-bb4dcdfcddb1	1fcf1f7d-82da-4582-be3c-9c9dd3e3cdd0	e5362e99-56ca-47d8-b47b-0275013552c1	2	2026-04-14 03:08:50.001306+00
\.


--
-- Data for Name: shows; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.shows (id, name, venue, start_date, end_date, created_at, status, venue_id) FROM stdin;
1fcf1f7d-82da-4582-be3c-9c9dd3e3cdd0	Spring Classic 2026		2026-04-18	2026-04-25	2026-04-12 13:11:26.900517+00	COMPLETED	\N
000b12cd-7884-44ed-8f4b-69d759104638	The BIG Show	Dan's Barn, New Prague, MN	2026-04-16	2026-04-27	2026-04-19 12:59:43.084183+00	ACTIVE	e806ee77-d930-4c51-bbbe-81ef7ba60796
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.users (id, role, full_name, email, created_at, hashed_password) FROM stdin;
fe461b7d-5381-4803-85ff-88da6c443509	ADMIN	Admin User	admin@horseshow.com	2026-04-13 20:55:37.130422+00	$2b$12$ULPWGreRoJbrPR41p/xlFeIkpCSOEq0.amvXzlPhFVpvgVxG9zhDu
68c3a45b-31d9-4fbc-8b5c-38e404ec9b09	SCOREKEEPER	Score Keeper	scorer@horseshow.com	2026-04-14 02:00:05.273128+00	$2b$12$LzvvczodthjelANbL2xw4uq7WY.DMfcqzDG90MOmaCh6vQmosIq4S
18d5ce01-d608-4f17-883f-a39a0b669b6b	EXHIBITOR	Dan Huber	danjhuber@hotmail.com	2026-04-14 02:10:26.263303+00	$2b$12$1zRG0w0PTUl5SUJ5fXyflewkgX4sdDR3EMX2.oLuDTo08AXIrpycu
d283c19e-4503-418c-8628-d4406410acc8	EXHIBITOR	Kristen Huber	kristen.huber17@gmail.com	2026-04-14 02:25:16.316627+00	$2b$12$l9GGrsd0Dv7SdwSEZYlyouNW0zrMFhgifgQkqaO2vbHUOnRq.SuMa
\.


--
-- Data for Name: venues; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.venues (id, name, address, city, state, created_at) FROM stdin;
02c0f54f-6f99-4168-8d85-52244d9daaf2	Fairgrounds Arena				2026-04-15 04:04:22.696138+00
e806ee77-d930-4c51-bbbe-81ef7ba60796	Dan's Barn		New Prague	MN	2026-04-19 12:59:16.094544+00
\.


--
-- Name: classes classes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_pkey PRIMARY KEY (id);


--
-- Name: divisions divisions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.divisions
    ADD CONSTRAINT divisions_pkey PRIMARY KEY (id);


--
-- Name: entries entries_class_id_rider_id_horse_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entries
    ADD CONSTRAINT entries_class_id_rider_id_horse_id_key UNIQUE (class_id, exhibitor_id, horse_id);


--
-- Name: entries entries_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entries
    ADD CONSTRAINT entries_pkey PRIMARY KEY (id);


--
-- Name: horses horses_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.horses
    ADD CONSTRAINT horses_pkey PRIMARY KEY (id);


--
-- Name: result_audit result_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.result_audit
    ADD CONSTRAINT result_audit_pkey PRIMARY KEY (id);


--
-- Name: results results_class_id_place_entry_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.results
    ADD CONSTRAINT results_class_id_place_entry_id_key UNIQUE (class_id, place, entry_id);


--
-- Name: results results_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.results
    ADD CONSTRAINT results_pkey PRIMARY KEY (id);


--
-- Name: exhibitor_horses rider_horses_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.exhibitor_horses
    ADD CONSTRAINT rider_horses_pkey PRIMARY KEY (id);


--
-- Name: exhibitor_horses rider_horses_rider_id_horse_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.exhibitor_horses
    ADD CONSTRAINT rider_horses_rider_id_horse_id_key UNIQUE (exhibitor_id, horse_id);


--
-- Name: exhibitors riders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.exhibitors
    ADD CONSTRAINT riders_pkey PRIMARY KEY (id);


--
-- Name: rings rings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rings
    ADD CONSTRAINT rings_pkey PRIMARY KEY (id);


--
-- Name: show_entries show_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.show_entries
    ADD CONSTRAINT show_entries_pkey PRIMARY KEY (id);


--
-- Name: show_entries show_entries_show_id_back_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.show_entries
    ADD CONSTRAINT show_entries_show_id_back_number_key UNIQUE (show_id, back_number);


--
-- Name: show_entries show_entries_show_id_rider_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.show_entries
    ADD CONSTRAINT show_entries_show_id_rider_id_key UNIQUE (show_id, exhibitor_id);


--
-- Name: shows shows_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.shows
    ADD CONSTRAINT shows_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: venues venues_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.venues
    ADD CONSTRAINT venues_pkey PRIMARY KEY (id);


--
-- Name: unique_back_number_per_class; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX unique_back_number_per_class ON public.entries USING btree (class_id, back_number) WHERE (back_number IS NOT NULL);


--
-- Name: classes classes_division_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_division_id_fkey FOREIGN KEY (division_id) REFERENCES public.divisions(id);


--
-- Name: classes classes_ring_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_ring_id_fkey FOREIGN KEY (ring_id) REFERENCES public.rings(id);


--
-- Name: classes classes_show_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_show_id_fkey FOREIGN KEY (show_id) REFERENCES public.shows(id) ON DELETE CASCADE;


--
-- Name: divisions divisions_show_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.divisions
    ADD CONSTRAINT divisions_show_id_fkey FOREIGN KEY (show_id) REFERENCES public.shows(id) ON DELETE CASCADE;


--
-- Name: entries entries_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entries
    ADD CONSTRAINT entries_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE CASCADE;


--
-- Name: entries entries_horse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entries
    ADD CONSTRAINT entries_horse_id_fkey FOREIGN KEY (horse_id) REFERENCES public.horses(id);


--
-- Name: entries entries_rider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entries
    ADD CONSTRAINT entries_rider_id_fkey FOREIGN KEY (exhibitor_id) REFERENCES public.exhibitors(id);


--
-- Name: result_audit result_audit_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.result_audit
    ADD CONSTRAINT result_audit_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id);


--
-- Name: result_audit result_audit_result_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.result_audit
    ADD CONSTRAINT result_audit_result_id_fkey FOREIGN KEY (result_id) REFERENCES public.results(id) ON DELETE CASCADE;


--
-- Name: results results_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.results
    ADD CONSTRAINT results_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE CASCADE;


--
-- Name: results results_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.results
    ADD CONSTRAINT results_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.entries(id) ON DELETE CASCADE;


--
-- Name: exhibitor_horses rider_horses_horse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.exhibitor_horses
    ADD CONSTRAINT rider_horses_horse_id_fkey FOREIGN KEY (horse_id) REFERENCES public.horses(id) ON DELETE CASCADE;


--
-- Name: exhibitor_horses rider_horses_rider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.exhibitor_horses
    ADD CONSTRAINT rider_horses_rider_id_fkey FOREIGN KEY (exhibitor_id) REFERENCES public.exhibitors(id) ON DELETE CASCADE;


--
-- Name: exhibitors riders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.exhibitors
    ADD CONSTRAINT riders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: rings rings_show_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rings
    ADD CONSTRAINT rings_show_id_fkey FOREIGN KEY (show_id) REFERENCES public.shows(id) ON DELETE CASCADE;


--
-- Name: show_entries show_entries_rider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.show_entries
    ADD CONSTRAINT show_entries_rider_id_fkey FOREIGN KEY (exhibitor_id) REFERENCES public.exhibitors(id);


--
-- Name: show_entries show_entries_show_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.show_entries
    ADD CONSTRAINT show_entries_show_id_fkey FOREIGN KEY (show_id) REFERENCES public.shows(id) ON DELETE CASCADE;


--
-- Name: shows shows_venue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.shows
    ADD CONSTRAINT shows_venue_id_fkey FOREIGN KEY (venue_id) REFERENCES public.venues(id);


--
-- PostgreSQL database dump complete
--

\unrestrict DzthRAASt6rMab35XuMOMnfc8RT4vLhxAMn6l9ogyxhTFvlQvMBl7KjoINGVDby

