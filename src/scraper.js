const cheerio = require('cheerio');
const fs = require('fs');
const request = require('request-promise');
const Entities = require('html-entities').XmlEntities;

const config = require('../config');
const debugFile = './assets/debug.json';
const logger = require('@coya/logger')();

const entities = new Entities();
const jar = buildCookiesJar();
const industries = {};
const followingItems = {};

function buildCookiesJar() {
	if(!config.cookie)
		throw new Error('The Linkedin cookie is required.');

	const jar = request.jar();
	jar.setCookie(request.cookie(`li_at=${config.cookie}`), 'https://www.linkedin.com');
	return jar;
}

function processPeopleProfile(item, result) {

	if (item.$type == 'com.linkedin.voyager.dash.common.Industry' && item.name)
		industries[item.entityUrn] = item.name;
	if (item.$type == 'com.linkedin.voyager.dash.identity.profile.Profile' && item.objectUrn) {
		result.firstName = item.firstName;
		result.lastName = item.lastName;
		result.headline = item.headline;
		result.location = item.locationName;
		result.address = item.address;
		result.industry = industries[item['*industry']];
		result.summary = item.summary;
		if (result.birthDate) {
			result.birthDate = item.birthDate;
			delete result.birthDate.$type;
		}
    if (item.profilePicture) {
      profilePictureReferance = item.profilePicture.displayImageReference;
      vectorImage = profilePictureReferance.vectorImage;
      result.profilePicture = vectorImage.rootUrl + vectorImage.artifacts[2].fileIdentifyingUrlPathSegment;
    }
	} else if (item.$type == 'com.linkedin.voyager.common.FollowingInfo' && item.followerCount)
		result.connections = item.followerCount;
	else if (item.$type == 'com.linkedin.voyager.dash.identity.profile.Position') {
		if (!result.positions)
			result.positions = [];
		const position = {
			title: item.title,
			company: item.companyName,
			location: item.location,
			description: item.description,
			dateRange: item.dateRange
		};
		if (position.dateRange) {
			delete position.dateRange.$type;
			if (position.dateRange.start) delete position.dateRange.start.$type;
			if (position.dateRange.end) delete position.dateRange.end.$type;
		}
		result.positions.push(position);
	} else if (item.$type == 'com.linkedin.voyager.dash.identity.profile.Education') {
		if (!result.education)
			result.education = [];
		const degree = {
			degree: item.degreeName,
			school: item.schoolName,
			field: item.fieldOfStudy,
			dateRange: item.dateRange
		};
		if (degree.dateRange) {
			delete degree.dateRange.$type;
			if (degree.dateRange.start) delete degree.dateRange.start.$type;
			if (degree.dateRange.end) delete degree.dateRange.end.$type;
		}
		result.education.push(degree);
	} else if (item.$type == 'com.linkedin.voyager.dash.identity.profile.Skill') {
		if (!result.skills)
			result.skills = [];
		result.skills.push(item.name);
	} else if (item.$type == 'com.linkedin.voyager.dash.identity.profile.Language') {
		if (!result.languages)
			result.languages = [];
		result.languages.push({ language: item.name, proficiency: item.proficiency });
	}
}

function processCompanyPage(item, result) {
	if (item.$type == 'com.linkedin.voyager.common.Industry')
		industries[item.entityUrn] = item.localizedName;
	else if (item.$type == 'com.linkedin.voyager.common.FollowingInfo')
		followingItems[item.entityUrn] = item.followerCount;
	else if (item.$type == 'com.linkedin.voyager.organization.Company' && item.tagline) {
		result.name = item.name;
		result.tagline = item.tagline;
		result.description = item.description;
		result.industry = industries[item['*companyIndustries'][0]];
		result.website = item.companyPageUrl;
		result.companySize = item.staffCountRange.start + (item.staffCountRange.end ? '-' + item.staffCountRange.end : '+') + ' employees';
		result.membersOnLinkedin = item.staffCount;
		result.headquarters = item.headquarter;
		delete result.headquarters.$type;
		result.companyType = item.companyType.localizedName;
		result.foundedYear = item.foundedOn && item.foundedOn.year;
		result.specialties = item.specialities;
		result.followers = followingItems[item[['*followingInfo']]];
	}
}

async function getCompanyOrPeopleDetails(url) {
	let processMethod;
	if (url.match(/^https:\/\/www.linkedin.com\/in\//)) processMethod = processPeopleProfile;
	else if (url.match(/^https:\/\/www.linkedin.com\/company\//)) {
		url += url[url.length - 1] == '/' ? 'about/' : '/about/';
		processMethod = processCompanyPage;
	} else throw new Error(`Invalid URL provided ("${url}"), it must be a people profile URL or a company page URL.`);

	if(process.env.NODE_ENV == 'dev')
		fs.writeFileSync(debugFile, '');

	// logger.info(`Sending request to ${url}...`);
	const html = await request({ url, jar });
	const $ = cheerio.load(html);
	let data, result = { linkedinUrl: url.replace('/about/', '') };
	while (!result.name && !result.firstName) {
		// this loop allows to fix a bug with random missing <code> tags
		for (let elt of $('code').get()) {
			try {
				data = JSON.parse(entities.decode($(elt).html()));
			} catch (e) {
				continue;
			}
			if (!data.included)
				continue;
			for (let item of data.included) {
				processMethod(item, result);
				if (process.env.NODE_ENV == 'dev')
					fs.appendFileSync(debugFile, JSON.stringify(item, null, 4) + '\n');
			}
		}
		// this company or people does not exist
		if (!result.firstName && !result.name)
			return null;
	}

	return result;
}

module.exports = {
	getCompanyOrPeopleDetails
};
