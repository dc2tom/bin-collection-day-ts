import { mocked } from 'ts-jest/utils'
import { services } from "ask-sdk-model";
import Address = services.deviceAddress.Address;
import {CheshireEastClient} from '../../../src/handlers/business-logic/CheshireEastClient'

test('test1', () => {
    let testSubject = new CheshireEastClient()

    let address: Address = {
        addressLine1 : "",
        postalCode : ""
    }

    let result = testSubject.getPropertyIdFromWebservice(address);

    console.log("Property ID is : " + result);

})
