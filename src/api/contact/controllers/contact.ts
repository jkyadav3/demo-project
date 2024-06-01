/**
 * contact controller
 */
import { Context, Next } from 'koa';
const next: Next = () => Promise.resolve();

import { factories } from '@strapi/strapi'

interface CreateResponse {
    data: {
        id: string;
        attributes: {
            phoneNumber: string;
            email: string;
        };
    };
}

//Method that returns the final object
const getIdentity = (contactRows) => {
    let primaryContact = null;
    const emails = new Set();
    const phoneNumbers = new Set();
    const secondaryContactIds = [];

    contactRows.forEach((contact) => {
        if (contact.linkPrecedence === "primary") {
            primaryContact = contact;
            if (contact.email) emails.add(contact.email);
            if (contact.phoneNumber) phoneNumbers.add(contact.phoneNumber);
        } else if (contact.linkPrecedence === "secondary") {
            if (contact.email) emails.add(contact.email);
            if (contact.phoneNumber) phoneNumbers.add(contact.phoneNumber);
            secondaryContactIds.push(contact.id);
        }
    });

    // Convert Sets to Arrays and maintain the order
    const emailsArray = Array.from(emails);
    const phoneNumbersArray = Array.from(phoneNumbers);

    // Ensure primary contact's email and phone number are first
    if (primaryContact.email) {
        emailsArray.splice(emailsArray.indexOf(primaryContact.email), 1);
        emailsArray.unshift(primaryContact.email);
    }
    if (primaryContact.phoneNumber) {
        phoneNumbersArray.splice(phoneNumbersArray.indexOf(primaryContact.phoneNumber), 1);
        phoneNumbersArray.unshift(primaryContact.phoneNumber);
    }

    return {
        primaryContactId: primaryContact.id,
        emails: emailsArray,
        phoneNumbers: phoneNumbersArray,
        secondaryContactIds: secondaryContactIds,
    };
};

const findPrimaryContactId = (contactRows) => {
    // Look for primaryContactId
    for (const item of contactRows) {
        if (item.linkPrecedence === "primary") {
            return item.id;
        } else {
            return item.linkedId;
        }
    }

    return null;
};

//This methods primary contact id for matching records
const findPrimaryContactIds = (contactRows) => {
    
    const primaryContactIds = [];
    for (const item of contactRows) {
        if (item.linkPrecedence === "primary") {
            primaryContactIds.push(item.id);
        }
    }

    return primaryContactIds;
};

//Method that fetches matching contact records from db
const getContactRows = async (email:string, phoneNumber:string) => {
    try {
        let condition = [];
        if (email) {
            condition.push({ email });
        }
        if (phoneNumber) {
            condition.push({ phoneNumber });
        }

        const entries = await strapi.db.query("api::contact.contact").findMany({
            where: {
                $or: condition,
            },
            orderBy: { id: "asc" },
        });

        return entries;
    } catch (error) {
        console.log("Exception:: getContactRows", error);
    }
};

export default factories.createCoreController('api::contact.contact', ({ strapi }) => ({

    async create(ctx) {
        const { email, phoneNumber, isIdentify = false } = ctx.request.body.data;
        // console.log("ctx.request.body.data", ctx.request.body.data);

        if (!email && !phoneNumber) {
            return ctx.badRequest("email and phoneNumber can't be blank.");
        }

        try {
            //Check here if the entry coming from identifyCustomer
            if (!isIdentify) {
                const entries = await getContactRows(email, phoneNumber);
                if (!entries.length) {
                    ctx.request.body.data.linkPrecedence = "primary";
                } else {
                    const primayContactId = findPrimaryContactId(entries);

                    ctx.request.body.data = {
                        ...ctx.request.body.data,
                        linkPrecedence: "secondary",
                        linkedId: primayContactId,
                    };
                }
            }

            const response = await super.create(ctx);

            return response;
        } catch (error) {
            console.log("Exception :: Create Contact", error);
            return ctx.internalServerError("Internal Server Error");
        }
    },

    async identifyCustomer(ctx) {
        const { email, phoneNumber } = ctx.request.body;

        if (!email && !phoneNumber) {
            return ctx.badRequest("Both parameters can't be blank...");
        }

        let primayContactId: number;

        try {
            const entries = await getContactRows(email, phoneNumber);

            //If no entries found then create a new entry in this case
            if (!entries.length) {
                ctx.request.body = {
                    data: { ...ctx.request.body, linkPrecedence: "primary", isIdentify: true },
                };

                const response = await this.create(ctx, next) as CreateResponse;

                const {
                    data: {
                        id,
                        attributes: { phoneNumber: customerPhone, email: customerEmail },
                    },
                } = response;

                return {
                    contact: {
                        primaryContatctId: id,
                        emails: customerEmail ? [customerEmail] : [],
                        phoneNumbers: customerPhone ? [customerPhone] : [],
                        secondaryContactIds: [],
                    },
                };
            } else {
                const primayContactIds = findPrimaryContactIds(entries);

                if (primayContactIds.length === 2) {
                    primayContactId = primayContactIds[0];
                    //Updating new one entry to secondary wity linkedId of old one
                    await strapi.entityService.update("api::contact.contact", primayContactIds[1], {
                        data: { linkPrecedence: "secondary", linkedId: primayContactId },
                    });
                } else {
                    primayContactId = findPrimaryContactId(entries);
                    //Check if this data set has new information
                    if (email && phoneNumber) {
                        const emails = new Set();
                        const phoneNumbers = new Set();

                        entries.forEach((contact) => {
                            if (contact.email) emails.add(contact.email);
                            if (contact.phoneNumber) phoneNumbers.add(contact.phoneNumber);
                        });

                        const hasEmail = emails.has(email);
                        const hasPhoneNumber = phoneNumbers.has(phoneNumber);

                        if (!hasEmail || !hasPhoneNumber) {
                            //Found a new information, create a secondary entry
                            ctx.request.body = {
                                data: { ...ctx.request.body, linkedId: primayContactId, linkPrecedence: "secondary", isIdentify: true },
                            };

                            const response = await this.create(ctx, next) as CreateResponse;

                            const {
                                data: {
                                    id,
                                    attributes: { phoneNumber: customerPhone, email: customerEmail },
                                },
                            } = response;
                        }
                    }
                }
            }

            const contactEntries = await strapi.db.query("api::contact.contact").findMany({
                where: {
                    $or: [{ id: primayContactId }, { linkedId: primayContactId }],
                },
            });

            let contact = null;
            if (contactEntries.length > 0) {
                contact = getIdentity(contactEntries);
            }

            return { contact };
        } catch (error) {
            console.log("Catch Error", error);
        }
    },

}));
