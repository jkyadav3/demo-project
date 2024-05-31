"use strict";

module.exports = {
  routes: [
    {
      method: "POST",
      path: "/identify",
      handler: "contact.identifyCustomer",
    },
  ],
};
