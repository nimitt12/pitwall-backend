-- Race calendar table backing the public GET /races endpoint and the
-- admin portal's "races" tab. There is no migration tool in this project
-- (see CLAUDE.md), so run this file manually against Postgres once.
--
-- Re-runnable: the table is created only if missing, and the seed upserts by id
-- so re-running won't duplicate rows or clobber values you've edited (it will
-- reset them to these defaults — comment out the seed if you don't want that).

CREATE TABLE IF NOT EXISTS races (
    id                TEXT PRIMARY KEY,
    season            TEXT NOT NULL,
    round             TEXT NOT NULL,
    race_name         TEXT,
    url               TEXT,
    circuit_id        TEXT,
    circuit_name      TEXT,
    circuit_url       TEXT,
    locality          TEXT,
    country           TEXT,
    lat               TEXT,
    long              TEXT,
    date              TEXT,
    time              TEXT,
    fp1_date          TEXT,
    fp1_time          TEXT,
    fp2_date          TEXT,
    fp2_time          TEXT,
    fp3_date          TEXT,
    fp3_time          TEXT,
    quali_date        TEXT,
    quali_time        TEXT,
    sprint_date       TEXT,
    sprint_time       TEXT,
    sprint_quali_date TEXT,
    sprint_quali_time TEXT,
    updated_at        TIMESTAMPTZ DEFAULT now()
);

-- 2026 season seed (22 rounds)
INSERT INTO races ("id", "season", "round", "race_name", "url", "circuit_id", "circuit_name", "circuit_url", "locality", "country", "lat", "long", "date", "time", "fp1_date", "fp1_time", "fp2_date", "fp2_time", "fp3_date", "fp3_time", "quali_date", "quali_time", "sprint_date", "sprint_time", "sprint_quali_date", "sprint_quali_time") VALUES
    ('2026_1', '2026', '1', 'Australian Grand Prix', 'https://en.wikipedia.org/wiki/2026_Australian_Grand_Prix', 'albert_park', 'Albert Park Grand Prix Circuit', 'https://en.wikipedia.org/wiki/Albert_Park_Circuit', 'Melbourne', 'Australia', '-37.8497', '144.968', '2026-03-08', '04:00:00Z', '2026-03-06', '01:30:00Z', '2026-03-06', '05:00:00Z', '2026-03-07', '01:30:00Z', '2026-03-07', '05:00:00Z', NULL, NULL, NULL, NULL),
    ('2026_2', '2026', '2', 'Chinese Grand Prix', 'https://en.wikipedia.org/wiki/2026_Chinese_Grand_Prix', 'shanghai', 'Shanghai International Circuit', 'https://en.wikipedia.org/wiki/Shanghai_International_Circuit', 'Shanghai', 'China', '31.3389', '121.22', '2026-03-15', '07:00:00Z', '2026-03-13', '03:30:00Z', NULL, NULL, NULL, NULL, '2026-03-14', '07:00:00Z', '2026-03-14', '03:00:00Z', '2026-03-13', '07:30:00Z'),
    ('2026_3', '2026', '3', 'Japanese Grand Prix', 'https://en.wikipedia.org/wiki/2026_Japanese_Grand_Prix', 'suzuka', 'Suzuka Circuit', 'https://en.wikipedia.org/wiki/Suzuka_International_Racing_Course', 'Suzuka', 'Japan', '34.8431', '136.541', '2026-03-29', '05:00:00Z', '2026-03-27', '02:30:00Z', '2026-03-27', '06:00:00Z', '2026-03-28', '02:30:00Z', '2026-03-28', '06:00:00Z', NULL, NULL, NULL, NULL),
    ('2026_4', '2026', '4', 'Miami Grand Prix', 'https://en.wikipedia.org/wiki/2026_Miami_Grand_Prix', 'miami', 'Miami International Autodrome', 'https://en.wikipedia.org/wiki/Miami_International_Autodrome', 'Miami', 'USA', '25.9581', '-80.2389', '2026-05-03', '20:00:00Z', '2026-05-01', '16:30:00Z', NULL, NULL, NULL, NULL, '2026-05-02', '20:00:00Z', '2026-05-02', '16:00:00Z', '2026-05-01', '20:30:00Z'),
    ('2026_5', '2026', '5', 'Canadian Grand Prix', 'https://en.wikipedia.org/wiki/2026_Canadian_Grand_Prix', 'villeneuve', 'Circuit Gilles Villeneuve', 'https://en.wikipedia.org/wiki/Circuit_Gilles_Villeneuve', 'Montreal', 'Canada', '45.5', '-73.5228', '2026-05-24', '20:00:00Z', '2026-05-22', '16:30:00Z', NULL, NULL, NULL, NULL, '2026-05-23', '20:00:00Z', '2026-05-23', '16:00:00Z', '2026-05-22', '20:30:00Z'),
    ('2026_6', '2026', '6', 'Monaco Grand Prix', 'https://en.wikipedia.org/wiki/2026_Monaco_Grand_Prix', 'monaco', 'Circuit de Monaco', 'https://en.wikipedia.org/wiki/Circuit_de_Monaco', 'Monte Carlo', 'Monaco', '43.7347', '7.42056', '2026-06-07', '13:00:00Z', '2026-06-05', '11:30:00Z', '2026-06-05', '15:00:00Z', '2026-06-06', '10:30:00Z', '2026-06-06', '14:00:00Z', NULL, NULL, NULL, NULL),
    ('2026_7', '2026', '7', 'Barcelona Grand Prix', 'https://en.wikipedia.org/wiki/2026_Barcelona-Catalunya', 'catalunya', 'Circuit de Barcelona-Catalunya', 'https://en.wikipedia.org/wiki/Circuit_de_Barcelona-Catalunya', 'Barcelona', 'Spain', '41.57', '2.26111', '2026-06-14', '13:00:00Z', '2026-06-12', '11:30:00Z', '2026-06-12', '15:00:00Z', '2026-06-13', '10:30:00Z', '2026-06-13', '14:00:00Z', NULL, NULL, NULL, NULL),
    ('2026_8', '2026', '8', 'Austrian Grand Prix', 'https://en.wikipedia.org/wiki/2026_Austrian_Grand_Prix', 'red_bull_ring', 'Red Bull Ring', 'https://en.wikipedia.org/wiki/Red_Bull_Ring', 'Spielberg', 'Austria', '47.2197', '14.7647', '2026-06-28', '13:00:00Z', '2026-06-26', '11:30:00Z', '2026-06-26', '15:00:00Z', '2026-06-27', '10:30:00Z', '2026-06-27', '14:00:00Z', NULL, NULL, NULL, NULL),
    ('2026_9', '2026', '9', 'British Grand Prix', 'https://en.wikipedia.org/wiki/2026_British_Grand_Prix', 'silverstone', 'Silverstone Circuit', 'https://en.wikipedia.org/wiki/Silverstone_Circuit', 'Silverstone', 'UK', '52.0786', '-1.01694', '2026-07-05', '14:00:00Z', '2026-07-03', '11:30:00Z', NULL, NULL, NULL, NULL, '2026-07-04', '15:00:00Z', '2026-07-04', '11:00:00Z', '2026-07-03', '15:30:00Z'),
    ('2026_10', '2026', '10', 'Belgian Grand Prix', 'https://en.wikipedia.org/wiki/2026_Belgian_Grand_Prix', 'spa', 'Circuit de Spa-Francorchamps', 'https://en.wikipedia.org/wiki/Circuit_de_Spa-Francorchamps', 'Spa', 'Belgium', '50.4372', '5.97139', '2026-07-19', '13:00:00Z', '2026-07-17', '11:30:00Z', '2026-07-17', '15:00:00Z', '2026-07-18', '10:30:00Z', '2026-07-18', '14:00:00Z', NULL, NULL, NULL, NULL),
    ('2026_11', '2026', '11', 'Hungarian Grand Prix', 'https://en.wikipedia.org/wiki/2026_Hungarian_Grand_Prix', 'hungaroring', 'Hungaroring', 'https://en.wikipedia.org/wiki/Hungaroring', 'Budapest', 'Hungary', '47.5789', '19.2486', '2026-07-26', '13:00:00Z', '2026-07-24', '11:30:00Z', '2026-07-24', '15:00:00Z', '2026-07-25', '10:30:00Z', '2026-07-25', '14:00:00Z', NULL, NULL, NULL, NULL),
    ('2026_12', '2026', '12', 'Dutch Grand Prix', 'https://en.wikipedia.org/wiki/2026_Dutch_Grand_Prix', 'zandvoort', 'Circuit Park Zandvoort', 'https://en.wikipedia.org/wiki/Circuit_Zandvoort', 'Zandvoort', 'Netherlands', '52.3888', '4.54092', '2026-08-23', '13:00:00Z', '2026-08-21', '10:30:00Z', NULL, NULL, NULL, NULL, '2026-08-22', '14:00:00Z', '2026-08-22', '10:00:00Z', '2026-08-21', '14:30:00Z'),
    ('2026_13', '2026', '13', 'Italian Grand Prix', 'https://en.wikipedia.org/wiki/2026_Italian_Grand_Prix', 'monza', 'Autodromo Nazionale di Monza', 'https://en.wikipedia.org/wiki/Monza_Circuit', 'Monza', 'Italy', '45.6156', '9.28111', '2026-09-06', '13:00:00Z', '2026-09-04', '10:30:00Z', '2026-09-04', '14:00:00Z', '2026-09-05', '10:30:00Z', '2026-09-05', '14:00:00Z', NULL, NULL, NULL, NULL),
    ('2026_14', '2026', '14', 'Spanish Grand Prix', 'https://en.wikipedia.org/wiki/2026_Spanish_Grand_Prix', 'madring', 'Madring', 'https://en.wikipedia.org/wiki/Madring', 'Madrid', 'Spain', '40.46528', '-3.61528', '2026-09-13', '13:00:00Z', '2026-09-11', '11:30:00Z', '2026-09-11', '15:00:00Z', '2026-09-12', '10:30:00Z', '2026-09-12', '14:00:00Z', NULL, NULL, NULL, NULL),
    ('2026_15', '2026', '15', 'Azerbaijan Grand Prix', 'https://en.wikipedia.org/wiki/2026_Azerbaijan_Grand_Prix', 'baku', 'Baku City Circuit', 'https://en.wikipedia.org/wiki/Baku_City_Circuit', 'Baku', 'Azerbaijan', '40.3725', '49.8533', '2026-09-26', '11:00:00Z', '2026-09-24', '08:30:00Z', '2026-09-24', '12:00:00Z', '2026-09-25', '08:30:00Z', '2026-09-25', '12:00:00Z', NULL, NULL, NULL, NULL),
    ('2026_16', '2026', '16', 'Singapore Grand Prix', 'https://en.wikipedia.org/wiki/2026_Singapore_Grand_Prix', 'marina_bay', 'Marina Bay Street Circuit', 'https://en.wikipedia.org/wiki/Marina_Bay_Street_Circuit', 'Marina Bay', 'Singapore', '1.2914', '103.864', '2026-10-11', '12:00:00Z', '2026-10-09', '08:30:00Z', NULL, NULL, NULL, NULL, '2026-10-10', '13:00:00Z', '2026-10-10', '09:00:00Z', '2026-10-09', '12:30:00Z'),
    ('2026_17', '2026', '17', 'United States Grand Prix', 'https://en.wikipedia.org/wiki/2026_United_States_Grand_Prix', 'americas', 'Circuit of the Americas', 'https://en.wikipedia.org/wiki/Circuit_of_the_Americas', 'Austin', 'USA', '30.1328', '-97.6411', '2026-10-25', '20:00:00Z', '2026-10-23', '17:30:00Z', '2026-10-23', '21:00:00Z', '2026-10-24', '17:30:00Z', '2026-10-24', '21:00:00Z', NULL, NULL, NULL, NULL),
    ('2026_18', '2026', '18', 'Mexico City Grand Prix', 'https://en.wikipedia.org/wiki/2026_Mexico_City_Grand_Prix', 'rodriguez', 'Autódromo Hermanos Rodríguez', 'https://en.wikipedia.org/wiki/Aut%C3%B3dromo_Hermanos_Rodr%C3%ADguez', 'Mexico City', 'Mexico', '19.4042', '-99.0907', '2026-11-01', '20:00:00Z', '2026-10-30', '18:30:00Z', '2026-10-30', '22:00:00Z', '2026-10-31', '17:30:00Z', '2026-10-31', '21:00:00Z', NULL, NULL, NULL, NULL),
    ('2026_19', '2026', '19', 'Brazilian Grand Prix', 'https://en.wikipedia.org/wiki/2026_Brazilian_Grand_Prix', 'interlagos', 'Autódromo José Carlos Pace', 'https://en.wikipedia.org/wiki/Interlagos_Circuit', 'São Paulo', 'Brazil', '-23.7036', '-46.6997', '2026-11-08', '17:00:00Z', '2026-11-06', '15:30:00Z', '2026-11-06', '19:00:00Z', '2026-11-07', '14:30:00Z', '2026-11-07', '18:00:00Z', NULL, NULL, NULL, NULL),
    ('2026_20', '2026', '20', 'Las Vegas Grand Prix', 'https://en.wikipedia.org/wiki/2026_Las_Vegas_Grand_Prix', 'vegas', 'Las Vegas Strip Street Circuit', 'https://en.wikipedia.org/wiki/Las_Vegas_Grand_Prix#Circuit', 'Las Vegas', 'USA', '36.1147', '-115.173', '2026-11-22', '04:00:00Z', '2026-11-20', '00:30:00Z', '2026-11-20', '04:00:00Z', '2026-11-21', '00:30:00Z', '2026-11-21', '04:00:00Z', NULL, NULL, NULL, NULL),
    ('2026_21', '2026', '21', 'Qatar Grand Prix', 'https://en.wikipedia.org/wiki/2026_Qatar_Grand_Prix', 'losail', 'Lusail International Circuit', 'https://en.wikipedia.org/wiki/Lusail_International_Circuit', 'Lusail', 'Qatar', '25.49', '51.4542', '2026-11-29', '16:00:00Z', '2026-11-27', '13:30:00Z', '2026-11-27', '17:00:00Z', '2026-11-28', '14:30:00Z', '2026-11-28', '18:00:00Z', NULL, NULL, NULL, NULL),
    ('2026_22', '2026', '22', 'Abu Dhabi Grand Prix', 'https://en.wikipedia.org/wiki/2026_Abu_Dhabi_Grand_Prix', 'yas_marina', 'Yas Marina Circuit', 'https://en.wikipedia.org/wiki/Yas_Marina_Circuit', 'Abu Dhabi', 'UAE', '24.4672', '54.6031', '2026-12-06', '13:00:00Z', '2026-12-04', '09:30:00Z', '2026-12-04', '13:00:00Z', '2026-12-05', '10:30:00Z', '2026-12-05', '14:00:00Z', NULL, NULL, NULL, NULL)
ON CONFLICT (id) DO UPDATE SET "season" = EXCLUDED."season", "round" = EXCLUDED."round", "race_name" = EXCLUDED."race_name", "url" = EXCLUDED."url", "circuit_id" = EXCLUDED."circuit_id", "circuit_name" = EXCLUDED."circuit_name", "circuit_url" = EXCLUDED."circuit_url", "locality" = EXCLUDED."locality", "country" = EXCLUDED."country", "lat" = EXCLUDED."lat", "long" = EXCLUDED."long", "date" = EXCLUDED."date", "time" = EXCLUDED."time", "fp1_date" = EXCLUDED."fp1_date", "fp1_time" = EXCLUDED."fp1_time", "fp2_date" = EXCLUDED."fp2_date", "fp2_time" = EXCLUDED."fp2_time", "fp3_date" = EXCLUDED."fp3_date", "fp3_time" = EXCLUDED."fp3_time", "quali_date" = EXCLUDED."quali_date", "quali_time" = EXCLUDED."quali_time", "sprint_date" = EXCLUDED."sprint_date", "sprint_time" = EXCLUDED."sprint_time", "sprint_quali_date" = EXCLUDED."sprint_quali_date", "sprint_quali_time" = EXCLUDED."sprint_quali_time", updated_at = now();
