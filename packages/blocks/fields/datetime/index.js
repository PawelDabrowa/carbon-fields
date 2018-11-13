/**
 * External dependencies.
 */
import { addFilter } from '@wordpress/hooks';
import { __ } from '@wordpress/i18n';

addFilter( 'carbon-fields.date_time-field.block', 'carbon-fields/blocks', ( OriginalDatetimeField ) => ( props ) => ( <OriginalDatetimeField buttonText={ __( 'Select Date' ) } { ...props } /> ) );
