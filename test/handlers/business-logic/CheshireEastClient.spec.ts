import { mocked } from 'ts-jest/utils'
import { services } from "ask-sdk-model";
import {ShortAddress} from '../../../src/models/ShortAddress';
import {CheshireEastClient} from '../../../src/handlers/business-logic/CheshireEastClient';

test('test1', () => {
    const testSubject = new CheshireEastClient();

    const address = new ShortAddress("Test", "SK11 3AB");

    const result = testSubject.getPropertyIdFromWebservice(address);

    console.log("Property ID is : " + result);

});
