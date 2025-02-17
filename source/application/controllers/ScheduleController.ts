import { Request, Response, NextFunction } from 'express';
import { getRepository } from 'typeorm';
import { ScheduleCell } from '../../domain/entities/ScheduleCell';
import { Station } from '../../domain/entities/Station';
import { Employee } from '../../domain/entities/Employee';
import { scheduleGenerator } from '../../infrastructure/scheduleGenerator/scheduleGenerator';
import {
	validateDateFormat,
	incrementDateByDay,
	formatDateString,
	orderStations,
} from '../../../util/utilities';
import { dailyDateSchedule, StationName } from '../../../typeDefs/types';
import { NotFoundError, BadRequestError } from 'routing-controllers';

export class ScheduleController {
	static getByDate = async (
		req: Request,
		res: Response,
		next: NextFunction
	) => {
		try {
			const date = req.query.date;
			if (typeof date !== 'string' || !validateDateFormat(date))
				return res.status(400).send(new BadRequestError('Wrong date format.'));

			const response = await getRepository(ScheduleCell).find({
				relations: ['station', 'employeeAtCell'],
				where: { date },
			});

			const completeDailySchedule: dailyDateSchedule = { date, schedules: {} };

			// if there are no schedule for given data controller should send back null arrays for each station

			req.body.stations.forEach((station: Station) => {
				completeDailySchedule.schedules[station.name] = new Array(
					station.numberOfCellsInTable
				).fill(null);
			});

			if (response.length) {
				response.forEach((tableCell: ScheduleCell) => {
					const stationName = tableCell.station.name;
					const employeeInCell = tableCell.employeeAtCell;
					const indexOfCell = tableCell.orderInTable;
					completeDailySchedule.schedules[stationName][indexOfCell] =
						employeeInCell;
				});
			}
			res.send(completeDailySchedule);
		} catch (error) {
			next(error);
		}
	};

	static create = async (req: Request, res: Response, next: NextFunction) => {
		if (
			!validateDateFormat(req.body.from) ||
			!validateDateFormat(req.body.to) ||
			new Date(req.body.from) > new Date(req.body.to)
		)
			return res.status(400).send(new BadRequestError('Invalid date.'));

		try {
			const scheduleCellsRepository = getRepository(ScheduleCell);

			const dates: string[] = [];
			let currentDate = new Date(req.body.from);
			const end = new Date(req.body.to);
			while (currentDate <= end) {
				if (![0, 6].includes(currentDate.getDay()))
					dates.push(formatDateString(currentDate));
				currentDate = incrementDateByDay(currentDate);
			}

			const createdCells: ScheduleCell[] = [];

			for (const date of dates) {
				const currentCellsAtDate = await scheduleCellsRepository.find({
					relations: ['station', 'employeeAtCell'],
					where: { date },
				});
				await scheduleCellsRepository.remove(currentCellsAtDate);

				for (const stationName in req.body.schedules) {
					if (
						Object.prototype.hasOwnProperty.call(
							req.body.schedules,
							stationName
						)
					) {
						const stationEntity: Station = req.body.stations.find(
							(stat: Station) => stat.name === stationName
						);

						const reqCellsAtStation = req.body.schedules[stationName];

						for (const [index, reqCell] of reqCellsAtStation.entries()) {
							const newCell = scheduleCellsRepository.create({
								date,
								station: stationEntity,
								employeeAtCell: reqCell,
								orderInTable: index,
							});

							createdCells.push(newCell);
						}
					}
				}
			}
			const response = await scheduleCellsRepository.save(createdCells);
			res.status(201).send({ message: 'Created.', schedules: response });
		} catch (error) {
			next(error);
		}
	};

	static update = async (req: Request, res: Response, next: NextFunction) => {
		try {
			const scheduleCellsRepository = getRepository(ScheduleCell);
			const cellsToSave: ScheduleCell[] = [];

			for (const stationName in req.body.schedules) {
				if (
					Object.prototype.hasOwnProperty.call(req.body.schedules, stationName)
				) {
					const stationEntity: Station = req.body.stations.find(
						(stat: Station) => stat.name === stationName
					);
					const reqCellsAtStation = req.body.schedules[stationName];
					const currentCellsAtStation = req.body.currentCellsPerDate.filter(
						(cell: ScheduleCell) => cell.station.name === stationName
					);

					for (const [index, reqCell] of reqCellsAtStation.entries()) {
						const newCell = scheduleCellsRepository.create({
							date: req.body.date,
							station: stationEntity,
							employeeAtCell: reqCell,
							orderInTable: index,
						});

						let updatedCell: ScheduleCell;
						if (currentCellsAtStation[index]) {
							newCell.id = currentCellsAtStation[index].id;
							updatedCell = await scheduleCellsRepository.preload(newCell);
						}
						cellsToSave.push(newCell || updatedCell);
					}
				}
			}
			const response = await scheduleCellsRepository.save(cellsToSave);
			res.send({ message: 'Updated.', homeRehabilitations: response });
		} catch (error) {
			next(error);
		}
	};

	static generate = async (req: Request, res: Response, next: NextFunction) => {
		try {
			// NIE DZIAŁA KIEDY W POPRZEDNI GRAFIK MA PRZEŁADOWANYCH PRACOWNIKÓW

			/* if (
				typeof req.query.date !== 'string' ||
				!validateDateFormat(req.query.date)
			)
				return res.status(400).send(new BadRequestError('Wrong date format.'));

			let date = new Date(req.query.date);
			do {
				date = new Date(date.setDate(date.getDate() - 1));
			} while ([0, 6].includes(date.getDay())); */

			/* const previousCells = await getRepository(ScheduleCell).find({
				relations: ['employeeAtCell', 'station'],
				where: { date },
			}); */

			/* 	const previousMorningEmployees = previousCells
				.filter(
					(cell) =>
						[0, 4].includes(cell.orderInTable) &&
						cell.station.name !== StationName.WIZYTY
				)
				.map((cell) => cell.employeeAtCell); */

			const generatedSchedule = scheduleGenerator(
				req.body.employees,
				orderStations(req.body.stations)
				// previousMorningEmployees
			);
			res.send({ generatedSchedule });
		} catch (error) {
			next(error);
		}
	};

	static deleteByDate = async (
		req: Request,
		res: Response,
		next: NextFunction
	) => {
		try {
			const date = req.params.date;
			if (typeof date !== 'string' || !validateDateFormat(date))
				return res.status(400).send(new BadRequestError('Wrong date format.'));

			const cellRepo = getRepository(ScheduleCell);
			const cellsAtDate = await cellRepo.find({
				where: { date },
			});
			if (!cellsAtDate.length)
				return res
					.status(404)
					.send(new NotFoundError('There are no schedules for a given data.'));

			await cellRepo.remove(cellsAtDate);
			res.status(204).send();
		} catch (error) {
			next(error);
		}
	};

	static verifyPayload = async (
		req: Request,
		res: Response,
		next: NextFunction
	) => {
		if (typeof req.body.schedules !== 'object')
			return res
				.status(400)
				.send(new BadRequestError('Incorrect request body.'));

		for (const stationName of Object.keys(req.body.schedules)) {
			const station = req.body.stations.find(
				(station: Station) => station.name === stationName
			);
			if (!station)
				return res
					.status(400)
					.send(new BadRequestError('Wrong station names.'));

			const cellsAtStaiton: (Employee | null)[] =
				req.body.schedules[stationName];
			for (const cellValue of cellsAtStaiton) {
				if (
					cellValue !== null &&
					!req.body.employees.some((emp: Employee) => emp.id === cellValue.id)
				)
					return res
						.status(400)
						.send(
							new BadRequestError(
								'Wrong schedules values. Accept null or employee object with valid id'
							)
						);
			}

			if (cellsAtStaiton.length !== station.numberOfCellsInTable)
				return res
					.status(400)
					.send(new BadRequestError('Wrong arrays length.'));
		}
		next();
	};

	static verifyUpdatePayload = async (
		req: Request,
		res: Response,
		next: NextFunction
	) => {
		const date = req.params.date;
		if (!validateDateFormat(date))
			return res.status(400).send(new BadRequestError('Invalid date.'));
		req.body.date = date;

		const scheduleCellsRepository = getRepository(ScheduleCell);
		const currentCellsPerDate = await scheduleCellsRepository.find({
			relations: ['station', 'employeeAtCell'],
			where: { date },
		});

		req.body.currentCellsPerDate = currentCellsPerDate;

		next();
	};
}
