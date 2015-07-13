window.carbon = window.carbon || {};

(function($) {

	var carbon = window.carbon;

	/*
	|--------------------------------------------------------------------------
	| Base Field MODEL
	|--------------------------------------------------------------------------
	|
	| This class represents the default model for a field.
	| The app will fallback to this class if a field has no dedicated model.
	|
	| A model is responsible for holding the fields current state (data).
	| It also has all the logic surrounding the data management, like: 
	|  - conversion
	|  - validation
	|  - access control
	|
	*/
	carbon.fields.Model = Backbone.Model.extend({
		defaults: {
			'error': false,
			'force_required': false,
		},

		initialize: function() {
			var classes = ['carbon-field', 'carbon-' + this.get('type')]
			var width = this.get('width');

			if (this.get('lazyload')) {
				classes.push('carbon-lazyload');
			}

			if (width && _.isNumber(width)) {
				classes.push('has-width');
				classes.push('width-' + width);
			}

			this.addClass(classes);
		},

		addClass: function(newClass) {
			if (!_.isArray(newClass)) {
				newClass = [newClass];
			}

			var oldClasses = this.get('classes') || [];
			var classes = _.union(oldClasses, newClass);

			if (classes.length !== oldClasses.length) {
				this.set('classes', classes);
			}
		},

		isRequired: function() {
			return !! ( this.get('required') || this.get('force_required') );
		},

		/*
		 * The validate method is an internal Backbone method.
		 * It will check if the field model data is valid.
		 *
		 * @see http://backbonejs.org/#Model-validate
		 */
		validate: function(attrs, options) {
			if (this.isRequired() && !attrs.value) {
				return crbl10n.message_required_field;
			}
		}
	});

	/*
	|--------------------------------------------------------------------------
	| Base Field VIEW
	|--------------------------------------------------------------------------
	|
	| Holds the field DOM interactions (rendering, error state, etc..).
	| The field view also SYNCs the user entered data with the model.
	| The app will fallback to this class if a field has no dedicated view.
	|
	| Views reflect what the applications data models look like.
	| They also listen to events and react accordingly.
	|
	| @element: .[id]
	| @holder:  carbon.views[id]
	|
	*/
	carbon.fields.View = Backbone.View.extend({
		/*
		 * Set the view DOM events
		 */
		events: {
			'change :input': 'sync'
		},

		/*
		 * Used to include additional variables that can be used inside the template
		 * Can be extended on the "field:beforeRender" event.
		 */
		templateVariables: {}, 

		/*
		 * Whether there was validation error at some point
		 */
		hadErrors: false,

		initialize: function() {
			this.rendered = false;

			this.on('field:rendered', function() {
				this.rendered = true;
			});

			// Set width
			this.on('field:rendered', this.setWidth);

			this.listenTo(this.model, 'change:height', this.equalizeHeight);

			// Listen for field class updates
			this.listenTo(this.model, 'change:classes', this.updateClass);

			// Listen for an error change and toggle the error class on the holder
			this.listenTo(this.model, 'change:error', this.toggleError);

			// Listen for value change and revalidate the model
			this.listenTo(this.model, 'change:value', this.revalidate);

			// Set the initial error state
			this.toggleError();
		},

		render: function() {
			var id = this.model.get('id');
			var type = this.model.get('type');
			var lazyload = this.model.get('lazyload');
			var template = carbon.template(type);

			$.extend(true, this.templateVariables, this.model.attributes, {
				model: this.model
			});

			this.trigger('field:beforeRender');

			var fieldHTML = template(this.templateVariables);

			this.$el.html(fieldHTML);

			if (lazyload) {
				carbon.lazyload[id] = this;
			} else {
				this.trigger('field:rendered');
			}

			return this;
		},

		/*
		 * Syncs the user entered value with the model value. 
		 * By default this method is fired when the input value has changed.
		 *
		 * If the field has more then one input, this method should be overwritten!
		 */
		sync: function(event) {
			var $input = $(event.currentTarget);
			var value = $input.val();

			this.model.set('value', value);
		},

		/* 
		 * If the field has had validation error (after form submission), 
		 * re-validate it after each value change. 
		 */
		revalidate: function(model) {
			if (model.isRequired() && this.hadErrors) {
				model.isValid();
				this.toggleError();
			}
		},

		toggleError: function() {
			var errorText = this.model.validationError;
			var $holder = this.$el.closest('.carbon-field');
			var $errorHolder = $holder.find('> .carbon-error');
			var hasError = !!errorText;

			$holder.toggleClass('carbon-highlight', hasError);

			$errorHolder.html(errorText);

			if (hasError) {
				this.hadErrors = true;
			}
		},

		setWidth: function() {
			var width = this.model.get('width');

			if (width && _.isNumber(width)) {
				this.$el.closest('.carbon-field').css('width', width + '%');
			}
		},

		updateClass: function(model) {
			var classes = model.get('classes');

			this.$el.closest('.carbon-field').addClass(classes.join(' '));
		},

		layoutUpdated: function() {
			this.trigger('layoutUpdated');
		}

	});

	/*
	|--------------------------------------------------------------------------
	| Base Field COLLECTION
	|--------------------------------------------------------------------------
	|
	| Holds a set of field models.
	| Also includes model class initialization logic.
	| 
	*/
	carbon.fields.Collection = Backbone.Collection.extend({
		model: function(attrs, options) {
			var FieldModel = carbon.fields.Model[attrs.type];

			// Set the field model. If the model is not found, fallback to the base model
			if (typeof FieldModel === 'undefined') {
				FieldModel = carbon.fields.Model; // Fallback to the base model
			}

			return new FieldModel(attrs, options);
		}
	});

	/******************************** BASE END ********************************/



	/*--------------------------------------------------------------------------
	 * MAP
	 *------------------------------------------------------------------------*/

	// Map VIEW
	carbon.fields.View.Map = carbon.fields.View.extend({
		events: {
			'update:marker': 'updateMarker',
			'keypress input.address': 'updateAddress',
			'click .address-search-btn': 'updateAddress'
		},

		initialize: function() {
			carbon.fields.View.prototype.initialize.apply(this);

			this.map = null;
			this.marker = null;

			this.listenTo(this.model, 'change:address', this.geocodeAddress);
			this.listenTo(this.model, 'change:lat change:lng', this.sync);
			this.listenTo(this.model, 'change:lat change:lng change:zoom', this.updateInput);

			this.on('field:rendered', this.initMap);
		},

		initMap: function() {
			var _this = this;
			var model = this.model;
			var map = this.map;
			var marker = this.marker;
			var zoom = model.get('zoom');
			var lat = model.get('lat');
			var lng = model.get('lng');
			var latLng = new google.maps.LatLng(lat, lng);
			var $element = this.$el;
			var $mapContainer = $element.find('.carbon-map-canvas');

			// draw a map
			map = this.map = new google.maps.Map($mapContainer.get(0), {
				zoom: zoom,
				center: latLng,
				mapTypeId: google.maps.MapTypeId.ROADMAP,
				scrollwheel: false
			});

			// add the marker
			marker = this.marker = new google.maps.Marker({
				position: latLng,
				map: map,
				draggable: true
			});

			// enable the scrollwheel zoom when the user interacts with the map
			google.maps.event.addListenerOnce(map, 'click', this.enableScrollZoom);
			google.maps.event.addListenerOnce(map, 'dragend', this.enableScrollZoom);

			// on marker drag, set the new position in the model
			google.maps.event.addListener(marker, "dragend", function (mEvent) { 
				_this.model.set({
					lat: marker.getPosition().lat(),
					lng: marker.getPosition().lng()
				});
			});

			// on zoom change, set the new zoom level
			google.maps.event.addListener(map, 'zoom_changed', function() {
				_this.model.set('zoom', map.getZoom());
			});

			// If we are in a widget container, resize the map when the widget is revealed.
			// This is a workaround since maps don't initialize in a hidden div (widget)
			$mapContainer.closest('div.widget').on('click.widgets-toggle', function(event){
				if ( $(event.target).parents('.widget-inside').length > 0 ) {
					return;
				};

				setTimeout(function() {
					google.maps.event.trigger(map, 'resize');
					_this.$el.trigger('update:marker');
				}, 1);
			});
		},

		sync: function(model) {
			var lat = model.get('lat');
			var lng = model.get('lng');

			if (lat && lng) {
				model.set('value', lat + ',' + lng);
			}
		},

		updateMarker: function(event) {
			var lat = this.model.get('lat');
			var lng = this.model.get('lng');
			var latLng = new google.maps.LatLng(lat, lng);

			if (this.marker) {
				this.marker.setPosition(latLng);
				this.map.setCenter(latLng);

				// Sync the current zoom level by triggering the zoom_changed event
				google.maps.event.trigger(this.map, 'zoom_changed');
			}
		},

		updateAddress: function(event) {
			var enterKey = 13;

			if (event.type === 'keypress' && event.keyCode !== enterKey) {
				return;
			}

			var name = this.model.get('name');
			var $input = this.$(':input[name="' + name + '[address]"]');
			var address = $input.val();

			this.model.set('address', address);

			event.preventDefault();
		},

		updateInput: function(model) {
			var name = model.get('name');

			for (var key in model.changed) {
				if (!model.changed.hasOwnProperty(key)) {
					continue;
				}

				var $input = this.$(':input[name="' + name + '[' + key + ']"]');
				var value = model.changed[key];

				if ($input.length) {
					$input.val(value);
				}
			}
		},

		geocodeAddress: function(model) {
			var _this = this;
			var address = model.get('address');
			var geocoder = new google.maps.Geocoder();

			if (!address) {
				return false;
			}

			if (coords = address.match(/^(-?\d{1,3}\.\d+),\s?(-?\d{1,3}\.\d+)$/)) {
				model.set({
					lat: parseFloat(coords[1]),
					lng: parseFloat(coords[2])
				});

				this.$el.trigger('update:marker');

				return true;
			}

			geocoder.geocode( { 'address': address }, function(results, status) {
				if (status == google.maps.GeocoderStatus.OK) {
					var latLng = results[0].geometry.location;

					model.set({
						lat: latLng.lat(),
						lng: latLng.lng()
					});

					_this.$el.trigger('update:marker');
				} else if(status === 'ZERO_RESULTS') {
					alert(crbl10n.geocode_zero_results);
				} else {
					alert(crbl10n.geocode_not_successful + status);
				}
			});
		},

		enableScrollZoom: function() {
			this.setOptions({
				scrollwheel: true,
				zoomControlOptions: {
					style: google.maps.ZoomControlStyle.LARGE
				}
			});
		}
	});


	/*--------------------------------------------------------------------------
	 * RICH TEXT
	 *------------------------------------------------------------------------*/

	// RichText VIEW
	carbon.fields.View.RichText = carbon.fields.View.extend({
		initialize: function() {
			carbon.fields.View.prototype.initialize.apply(this);

			this.active = false;

			this.on('field:rendered', this.initEditor);
			this.on('sortstart', this.disableEditor);
			this.on('sortstop', this.enableEditor);
		},

		initEditor: function() {
			if( typeof tinyMCEPreInit === 'undefined' || typeof tinymce === 'undefined' ) {
				return false;
			}

			var mceInit = this.get_mceInit();
			var qtInit = this.get_qtInit();

			tinyMCEPreInit.mceInit[ mceInit.id ] = mceInit;
			tinyMCEPreInit.qtInit[ qtInit.id ] = qtInit;

			if (!this.active) {
				try {
					// Set the editor ID on media buttons
					this.mediaButtonsInit();

					// initialize mceInit
					tinymce.init(mceInit);

					// initialize qtInit (quicktags)
					var qtag = quicktags( qtInit );
					this.textButtonsInit( qtag );

					this.active = true;
				} catch(e) {
					console.log(e);
				}
			}
		},

		get_mceInit: function(){
			var $field = this.$el;
			var id = this.model.get('id');
			var mceInit = $.extend({}, tinyMCEPreInit.mceInit.carbon_settings);
			var isTouchscreen = carbon.views.main.$body.hasClass('touchscreen');

			// set selector
			mceInit.selector = '#' + id;

			// set id
			mceInit.id = id; // tinymce v4
			mceInit.elements = id; // tinymce v3

			// events
			if(tinymce.majorVersion < 4) {
				mceInit.setup = function(ed){
					ed.onInit.add(function(ed, event) {
						$(ed.getBody()).on('blur', function(){
							// save to textarea
							ed.save();

							// trigger change on textarea
							$field.find('textarea').trigger('change');
						});
					});
				};
			} else {
				mceInit.setup = function(ed){
					ed.on('blur', function(e) {
						// save to textarea
						ed.save();

						// trigger change on textarea
						$field.find('textarea').trigger('change');
					});
					
				};
			}

			mceInit.wp_autoresize_on = isTouchscreen ? false : true;

			return mceInit;
		},

		get_qtInit: function(){
			var qtInit = $.extend({}, tinyMCEPreInit.qtInit.carbon_settings);

			qtInit.id = this.model.get('id');

			return qtInit;
		},

		mediaButtonsInit: function() {
			var id = this.model.get('id');

			this.$('.wp-media-buttons .button:not([data-editor])').each(function() {
				$(this).attr('data-editor', id);
			});
		},

		textButtonsInit: function(ed) {
			var defaults = ',strong,em,link,block,del,ins,img,ul,ol,li,code,more,close,';

			var canvas = ed.canvas;
			var name = ed.name;
			var settings = ed.settings;
			var theButtons = {};
			var html = '';
			var use = '';

			// set buttons
			if ( settings.buttons ) {
				use = ','+settings.buttons+',';
			}

			for ( i in edButtons ) {
				if ( !edButtons[i] ) {
					continue;
				}

				id = edButtons[i].id;
				if ( use && defaults.indexOf( ',' + id + ',' ) !== -1 && use.indexOf( ',' + id + ',' ) === -1 ) {
					continue;
				}

				if ( !edButtons[i].instance || edButtons[i].instance === inst ) {
					theButtons[id] = edButtons[i];

					if ( edButtons[i].html ) {
						html += edButtons[i].html(name + '_');
					}
				}
			}

			if ( use && use.indexOf(',fullscreen,') !== -1 ) {
				theButtons.fullscreen = new qt.FullscreenButton();
				html += theButtons.fullscreen.html(name + '_');
			}

			if ( 'rtl' === document.getElementsByTagName('html')[0].dir ) {
				theButtons.textdirection = new qt.TextDirectionButton();
				html += theButtons.textdirection.html(name + '_');
			}

			ed.toolbar.innerHTML = html;
			ed.theButtons = theButtons;
		},

		disableEditor: function() {
			if (!this.active) {
				return false;
			}

			try {
				var id = this.model.get('id');
				var ed = tinyMCE.get(id);

				if (!ed) {
					$.error('RichText Field - tinyMCE editor not found.');
				}
				
				// save
				ed.save();
				
				// destroy editor
				ed.destroy();
			} catch(e) {
				console.log(e);
			}
		},
		
		enableEditor: function() {
			if (!this.active) {
				return false;
			}

			var $editor = this.$('.carbon-wysiwyg');

			if($editor.hasClass('tmce-active') && window.switchEditors ) {
				var id = this.model.get('id');
				switchEditors.go(id, 'tmce');
			}
		}
	});


	/*--------------------------------------------------------------------------
	 * DATE
	 *------------------------------------------------------------------------*/

	// Date VIEW
	carbon.fields.View.Date = carbon.fields.View.extend({
		initialize: function() {
			carbon.fields.View.prototype.initialize.apply(this);

			this.on('field:rendered', this.initDatePicker);
		},

		initDatePicker: function() {
			var $field = this.$('.carbon-datepicker');
			var $trigger = this.$('.carbon-datepicker-trigger');
			var options = this.model.get('options');
			var args = {
				dateFormat: 'yy-mm-dd',
				changeMonth: true,
				changeYear: true,
				showButtonPanel: true,
				hideIfNoPrevNext: true,
				beforeShow: function(input, inst) {
					$('#ui-datepicker-div').addClass('carbon-jquery-ui');
				}
			};

			$.extend(args, options);

			$field.datepicker(args);

			$trigger.on('click', function(e) {
				$field.focus();
				
				e.preventDefault();
			});
		}
	});


	/*--------------------------------------------------------------------------
	 * COLOR PICKER
	 *------------------------------------------------------------------------*/

	// Color VIEW
	carbon.fields.View.Color = carbon.fields.View.extend({
		events: function() {
			return _.extend({}, carbon.fields.View.prototype.events, {
				'click .pickcolor.button': 'focusField',
				'focus input.carbon-color': 'showColorPicker'
			});
		},

		initialize: function() {
			carbon.fields.View.prototype.initialize.apply(this);

			this.on('field:rendered', this.initColorPicker);
		},

		showColorPicker: function(event) {
			var $colorpicker = this.$('.carbon-color-container');
			$colorpicker.show();
		},

		focusField: function(event) {
			var $field = this.$('input.carbon-color');
			var $colorpicker = this.$('.carbon-color-container');

			$field.focus();
		},

		initColorPicker: function() {
			var $colorpicker = this.$('.carbon-color-container');
			var $button = this.$('.button');
			var $field = this.$('input.carbon-color');
			var farbtasticObj = {};

			farbtasticObj = $.farbtastic($colorpicker, function(color) {
				$button
					.css('background-color', color)
					.addClass('has-color');

				// Fix IE bug - rgb() values for color not redrawing automatically
				$button.hide(0, function() {
					$button.css('display', 'inline');
				});
				
				$field.val(color).trigger('change');
			});

			farbtasticObj.setColor($field.val());

			// Update Color field after changing the value manually
			$field.on('blur', function(event) {
				var newColor = $field.val();

				$colorpicker.hide();

				newColor = $.trim(newColor);
				if ( newColor.length === 0 ) {
					$button
						.css('background-color', '#fff')
						.removeClass('has-color');
					$field.val('').trigger('change');
					return;
				};

				if (newColor[0] !== '#') {
					newColor = '#' + newColor;
				};

				if ( /^#([0-9A-F]{3}){1,2}$/i.test(newColor) ) {
					farbtasticObj.setColor(newColor);
				} else {
					$field
						.val(farbtasticObj.color)
						.addClass('error')
						.trigger('change');

					setTimeout(function() {
						$field.removeClass('error');
					}, 150);
				}
			});
		}
	});

	/*--------------------------------------------------------------------------
	 * SELECT
	 *------------------------------------------------------------------------*/

	// Select MODEL
	carbon.fields.Model.Select = carbon.fields.Model.extend({
		initialize: function() {
			carbon.fields.Model.prototype.initialize.apply(this);

			var _this = this;
			var value = this.get('value');
			var options = this.get('options') || [];

			// If no value, set the first option as value
			if (!value) {
				$.each(options, function(i, option) {
					_this.set('value', option.value);
					return false;
				});
			}
		},

		validate: function(attrs, options) {
			var value = attrs.value;

			if (this.isRequired() && (!value || value === '0')) {
				return crbl10n.message_choose_option;
			}
		}
	});


	/*--------------------------------------------------------------------------
	 * GRAVITY FORM
	 *------------------------------------------------------------------------*/

	// Gravity Form MODEL
	carbon.fields.Model.GravityForm = carbon.fields.Model.Select.extend({
		initialize: function() {
			carbon.fields.Model.Select.prototype.initialize.apply(this);
		}
	});


	/*--------------------------------------------------------------------------
	 * CHOOSE SIDEBAR
	 *------------------------------------------------------------------------*/

	// Choose Sidebar MODEL
	carbon.fields.Model.ChooseSidebar = carbon.fields.Model.Select.extend({
		initialize: function() {
			carbon.fields.Model.Select.prototype.initialize.apply(this);
		},

		validate: function(attrs, options) {
			return carbon.fields.Model.prototype.validate.apply(this, arguments);
		}
	});

	// Choose Sidebar VIEW
	carbon.fields.View.ChooseSidebar = carbon.fields.View.extend({
		events: function() {
			return _.extend({}, carbon.fields.View.prototype.events, {
				'change select': 'addNew'
			});
		},

		initialize: function() {
			carbon.fields.View.prototype.initialize.apply(this);
		},

		addNew: function(event) {
			var $select = $(event.target);
			var $option;
			var newSidebar;

			if ($select.val() !== 'new') {
				return true;
			}

			newSidebar = $.trim( window.prompt(crbl10n.enter_name_of_new_sidebar) );

			if (newSidebar) {
				$option = $('<option value="' + _.escape(newSidebar) + '">' + newSidebar + '</option>').insertBefore($select.find('option:last'));
				
				$select.find('option').prop('selected', false);
				$option.prop('selected', true);
			} else {
				$select.find('option:first').prop('selected', true);
			}

			$select.trigger('change');
		}
	});


	/*--------------------------------------------------------------------------
	 * FILE
	 *------------------------------------------------------------------------*/

	// File VIEW
	carbon.fields.View.File = carbon.fields.View.extend({
		events: function() {
			return _.extend({}, carbon.fields.View.prototype.events, {
				'click .c2_open_media': 'openMedia'
			});
		},

		initialize: function() {
			carbon.fields.View.prototype.initialize.apply(this);

			this.on('field:beforeRender', this.loadDescriptionTemplate);

			this.listenTo(this.model, 'change:value', this.updateInput);
			this.listenTo(this.model, 'change:url', this.updateView);
		},

		/**
		 * Loads the description template and sets it as a variable ("description") for the base template
		 */
		loadDescriptionTemplate: function() {
			var type = this.model.get('type');
			var descTemplate = carbon.template(type + '-Description');

			_.extend(this.templateVariables, {
				description: descTemplate(this.templateVariables)
			});
		},

		openMedia: function(event) {
			var _this = this;
			var type = this.model.get('type');
			var buttonLabel = this.model.get('window_button_label');
			var windowLabel = this.model.get('window_label');
			var typeFilter = this.model.get('type_filter');
			var valueType = this.model.get('value_type');
			var mediaTypes = {};

			var getAttachmentThumb = function(attachment) {
				var thumbUrl = '';

				// Get the thumbnail (if any)
				if (attachment.type === 'image' && attachment.sizes) {
					var size = attachment.sizes.thumbnail || attachment.sizes.full;
					thumbUrl = size.url;
				}

				return thumbUrl;
			};

			mediaTypes[type] = wp.media.frames.crbMediaField = wp.media({
				title: windowLabel ? windowLabel : crbl10n.title,
				library: { type: typeFilter }, // audio, video, image
				button: { text: buttonLabel },
				multiple: true
			});

			var mediaField = mediaTypes[type];

			// Runs when an image is selected.
			mediaField.on('select', function () {
				// Grabs the attachment selection and creates a JSON representation of the model.
				var mediaAttachments = mediaField.state().get('selection').toJSON();

				// Get the first attachment and remove it from the array
				var mediaAttachment = mediaAttachments.shift();

				// If multiple attachments, multiply the field
				_.each(mediaAttachments, function(att) {
					_this.model.set('multiply', {
						'value': att[valueType],
						'file_type': att.type,
						'url': att.url,
						'thumb_url': getAttachmentThumb(att)
					});
				});

				var mediaValue = mediaAttachment[valueType];
				var thumbUrl = getAttachmentThumb(mediaAttachment);

				// Update the model
				this.model.set('file_type', mediaAttachment.type);
				this.model.set('value', mediaValue);
				this.model.set('url', mediaAttachment.url);
				this.model.set('thumb_url', thumbUrl);

				// Trigger an event that notifies that a media file is selected
				this.trigger('media:updated', mediaAttachment);
			}, this);

			// Opens the media library frame
			mediaField.open();

			event.preventDefault();
		},

		updateInput: function(model) {
			var $input = this.$('input.carbon-file-field');
			var value = model.get('value');

			if (!value) {
				model.set('url', '')
			}

			$input.val(value).trigger('change');
		},

		updateView: function(model) {
			var url = model.get('url');

			this.$('.attachment-url').html(url);
			this.$('.carbon-view_file').attr('href', url);
			this.$('.carbon-description').toggleClass('hidden', !url);
		}
	});

	
	/*--------------------------------------------------------------------------
	 * ATTACHMENT
	 *------------------------------------------------------------------------*/

	// Attachment VIEW
	carbon.fields.View.Attachment = carbon.fields.View.File.extend({
		events: function() {
			return _.extend({}, carbon.fields.View.File.prototype.events(), {
				'click .carbon-file-remove': 'removeFile'
			});
		},

		initialize: function() {
			carbon.fields.View.File.prototype.initialize.apply(this);

			this.listenTo(this.model, 'change:thumb_url', this.updateThumb);
		},

		updateThumb: function(model) {
			var thumbUrl = model.get('thumb_url');

			this.$('img.thumbnail-image').attr('src', thumbUrl);
			this.$('.carbon-attachment-preview').toggleClass('hidden', !thumbUrl);
		},

		removeFile: function(event) {
			this.$('.carbon-description').addClass('hidden');
			this.$('.carbon-attachment-preview').addClass('hidden');
			this.$('input.carbon-file-field').attr('value', '').trigger('change');
			this.$('.attachment-url').html('');

			this.model.set('url', '');
			this.model.set('thumb_url', '');
		}
	});


	/*--------------------------------------------------------------------------
	 * IMAGE
	 *------------------------------------------------------------------------*/

	// Image VIEW
	carbon.fields.View.Image = carbon.fields.View.Attachment.extend({
		initialize: function() {
			carbon.fields.View.Attachment.prototype.initialize.apply(this);
		}
	});


	/*--------------------------------------------------------------------------
	 * SET
	 *------------------------------------------------------------------------*/

	// Set MODEL
	carbon.fields.Model.Set = carbon.fields.Model.extend({
		validate: function(attrs, options) {
			if (this.isRequired() && _.isEmpty(attrs.value)) {
				return crbl10n.message_required_field;
			}
		}
	});

	// Set VIEW
	carbon.fields.View.Set = carbon.fields.View.extend({
		initialize: function() {
			carbon.fields.View.prototype.initialize.apply(this);

			this.on('field:rendered', this.showAll);
		},

		showAll: function() {
			this.$('a.carbon-set-showall').one('click', function (event) {
				$(this).parent().hide().siblings().show();

				event.preventDefault();
			});
		},

		sync: function(event) {
			var value = [];

			this.$('input[type="checkbox"]:checked').each(function() {
				value.push($(this).val());
			});

			this.model.set('value', value);
		}
	});


	/*--------------------------------------------------------------------------
	 * RELATIONSHIP
	 *------------------------------------------------------------------------*/

	// Relationship MODEL
	carbon.fields.Model.Relationship = carbon.fields.Model.extend({
		validate: function(attrs, options) {
			if (this.isRequired() && _.isEmpty(attrs.value)) {
				return crbl10n.message_required_field;
			}
		}
	});

	// Relationship VIEW
	carbon.fields.View.Relationship = carbon.fields.View.extend({
		disabledClass: 'inactive',

		events: {
			'click .relationship-left .relationship-list a': 'addItem',
			'click .relationship-right .relationship-list a': 'removeItem',
			'keypress .relationship-left .search-field': 'searchFieldKeyPress',
			'keyup .relationship-left .search-field': 'searchFilter'
		},

		initialize: function() {
			carbon.fields.View.prototype.initialize.apply(this);

			this.selectedItems = [];

			this.on('field:rendered', this.initRelationship);
			this.on('field:relationship:afterAdd field:relationship:afterRemove field:relationship:afterSort', this.sync);
		},

		initRelationship: function() {
			var _this = this;
			var allowDuplicates = this.model.get('allow_duplicates');
			var name = this.model.get('name');
			var isTouchscreen = carbon.views.main.$body.hasClass('touchscreen');

			this.$leftList = this.$('.relationship-left .relationship-list');
			this.$rightList = this.$('.relationship-right .relationship-list');
			this.$searchBox = this.$('.relationship-left .search-field');

			// Fetch the selected items and deactivate them 
			// in the left list (if duplicate items are not allowed)
			this.$rightList.find('input[name="' + name + '[]"]').each(function() {
				_this.selectedItems.push(this.value);
				if (!allowDuplicates) {
					_this.$leftList.find('a[data-value="' + this.value + '"]').parent().addClass(_this.disabledClass);
				}
			});

			var sortableOptions = {
				axis: "y",
				items: '> li',
				forceHelperSize: true,
				forcePlaceholderSize: true,
				placeholder: 'ui-placeholder-highlight',
				scroll: true,
				update: function() {
					_this.trigger('field:relationship:afterSort');
				}
			};

			if (isTouchscreen) {
				sortableOptions.handle = '.mobile-handle';
			}

			this.$rightList.sortable(sortableOptions);

			this.trigger('field:initialized');
		},

		sync: function() {
			var _this = this;
			var value = [];

			this.$rightList.find('> li > a').each(function() {
				var link = $(this);
				var item = _this.buildItem(
					link.data('item-id'), 
					link.data('item-title'), 
					link.data('item-type'), 
					link.data('item-subtype'),
					link.data('item-label')
				);
				value.push(item);
			});

			this.model.set('value', value);
		},

		addItem: function(event) {
			var $element = $(event.target);
			if (!$element.is('a')) {
				$element = $element.closest('a');
			}

			var allowDuplicates = this.model.get('allow_duplicates');
			var max = this.model.get('max');
			var id = $element.data('item-id');
			var type = $element.data('item-type');
			var subtype = $element.data('item-subtype');
			var label = $element.data('item-label');
			var title = $element.data('item-title');
			var value = this.buildItemValue(id, type, subtype);
			var liTemplate = carbon.template(this.model.get('type') + '_item');
			var newLi;

			// Prevent adding duplicate items (if not allowed)
			if ( !allowDuplicates && $.inArray(value, this.selectedItems) > -1 ) {
				return false;
			};

			// Prevent adding more items than the maximum (if any)
			if ( max > 0 && this.selectedItems.length >= max ) {
				alert(crbl10n.max_num_items_reached.replace('%s', max));
				return false;
			};

			this.trigger('field:relationship:beforeAdd');

			if (!allowDuplicates) {
				$element.parent().addClass(this.disabledClass);
			}

			// Build the new <li> item to append in the right list
			newLi = liTemplate({
				name: this.model.get('name'),
				item: this.buildItem(id, title, type, subtype, label)
			});

			this.$rightList.append(newLi);
			this.selectedItems.push(value);

			this.trigger('field:relationship:afterAdd');

			event.preventDefault();
		},

		removeItem: function(event) {
			var $element = $(event.target);
			if (!$element.is('a')) {
				$element = $element.closest('a');
			}

			var value = $element.siblings('input').val();
			var position = $.inArray(value, this.selectedItems);
			var allowDuplicates = this.model.get('allow_duplicates');

			// Only existing items can be removed
			if ( position < 0 ) {
				return false;
			};

			this.trigger('field:relationship:beforeRemove');

			this.selectedItems.splice(position, 1);
			$element.parent().remove();

			if (!allowDuplicates) {
				this.$leftList.find('a[data-value="' + value + '"]').parent().removeClass(this.disabledClass);
			}

			this.trigger('field:relationship:afterRemove');
			
			event.preventDefault();
		},

		searchFieldKeyPress: function(event) {
			if( event.which == 13 ) {
				event.preventDefault();
			}
		},

		searchFilter: function(event) {
			var $element = $(event.target);
			var val = $element.val();

			this.trigger('field:relationship:beforeFilter');

			this.$leftList.find('li a:containsInsensitive("' + val + '")').show();
			this.$leftList.find('li a:not(:containsInsensitive("' + val + '"))').hide();

			this.trigger('field:relationship:afterFilter');

			event.preventDefault();
		},

		buildItem: function(id, title, type, subtype, label) {
			return {
				id: id,
				title: title,
				type: type,
				subtype: subtype,
				label: label
			};
		},

		buildItemValue: function(id, type, subtype) {
			return id + "";
		}
	});

	/*--------------------------------------------------------------------------
	 * ASSOCIATION
	 *------------------------------------------------------------------------*/

	// Association MODEL
	carbon.fields.Model.Association = carbon.fields.Model.Relationship.extend({
		initialize: function() {
			carbon.fields.Model.Relationship.prototype.initialize.apply(this);

			this.addClass('carbon-Relationship');
		}
	});

	// Association VIEW
	carbon.fields.View.Association = carbon.fields.View.Relationship.extend({
		initialize: function() {
			carbon.fields.View.Relationship.prototype.initialize.apply(this);
		},

		buildItemValue: function(id, type, subtype) {
			var sep = ':';
			return type + sep + subtype + sep + id;
		}
	});

	/*--------------------------------------------------------------------------
	 * COMPLEX
	 *------------------------------------------------------------------------*/

	// Complex MODEL
	carbon.fields.Model.Complex = carbon.fields.Model.extend({
		defaults: {
			'index': 0,
			'force_required': true
		},

		getGroupByName: function(name) {
			var groups = this.get('groups') || [];
			var group = null;

			for (var i = 0; i < groups.length; i++) {
				var grp = groups[i];

				if (grp.hasOwnProperty('name') && grp.name == name) {
					group = grp;
					break;
				}
			}

			return group;
		},

		validate: function(attrs, options) {
			var hasErrors = false;
			var view = carbon.views[this.get('id')];

			if (!view) {
				return;
			}

			_.each(view.groupsCollection.models, function(group) {
				if (!group.isValid()) {
					hasErrors = true;
					return; // break the loop
				}
			});

			if (hasErrors) {
				return crbl10n.message_form_validation_failed;
			}
		}
	});

	// Complex VIEW
	carbon.fields.View.Complex = carbon.fields.View.extend({
		events: {
			'click > .carbon-subcontainer > .carbon-actions a': 'buttonAction',
			'click > .carbon-subcontainer > .carbon-empty-row a': 'buttonAction'
		},

		initialize: function() {
			carbon.fields.View.prototype.initialize.apply(this);

			this.multipleGroups = this.model.get('multiple_groups');

			/*
			 * Groups Collection
			 */

			this.groupsCollection = new carbon.fields.Collection.Group;

			// Set the model attribute on which the collection will be sorted. Think of it as "orderBy".
			this.groupsCollection.comparator = 'order'; 

			// Groups collection events (order matters)
			this.listenTo(this.groupsCollection, 'add',        this.setGroupOrder);  // Set the initial group order
			this.listenTo(this.groupsCollection, 'add',        this.setGroupIndex);  // Set the group index, the index should be unique for each group
			this.listenTo(this.groupsCollection, 'remove',     this.checkMin);       // Checks the minimum number of rows
			this.listenTo(this.groupsCollection, 'add remove', this.checkMax);       // Checks the maximum number of rows
			this.listenTo(this.groupsCollection, 'add remove', this.toggleIntroRow); // Show/Hide the "There are no Entries" row
			this.listenTo(this.groupsCollection, 'add remove', this.sortGroups);     // Forces group sorting while they are added/removed and not after that
			this.listenTo(this.groupsCollection, 'sort',       this.reorderGroups);  // Sort event is trigger after the "add" event
			this.listenTo(this.groupsCollection, 'add',        this.setGroupID);     // Sets an unique ID for each group
			this.listenTo(this.groupsCollection, 'add',        this.renderGroup);    // Render the added group

			/*
			 * View Events
			 */

			// Propagate the event to all groups
			this.on('propagate', function(event) {
				carbon.containers.View.prototype.eventPropagator.apply(this, [this.groupsCollection, event]);
			});

			// Set some jQuery variables.
			// This should be done before the groups population (to avoid getting elements from inner views) and after the template has rendered
			this.on('field:rendered', this.setDOMVariables);

			// Populate the groups collection using the database data
			this.on('field:rendered', this.setGroups);

			// Syncs the data from the groups to the complex field model (after the initial population)
			this.on('field:rendered', function() {
				this.listenTo(this.groupsCollection, 'change', this.sync);
			});

			// Enable jQuery Sortable after the groups are populated
			this.on('field:rendered', this.sortable);

			// Add a listener that will hide the groups list when the body is clicked
			if (this.multipleGroups) {
				this.on('field:rendered', this.hideGroupsListListener);
			}
		},

		sync: function(model, collection) {
			var ignored = ['collapsed'];

			for (var i = 0; i < ignored.length; i++) {
				if (model.changed.hasOwnProperty(ignored[i])) {
					return false;
				}
			}

			this.model.set('value', this.groupsCollection.toJSON());
		},

		setGroupOrder: function(model, collection) {
			var order = model.get('order');

			if (order === null) {
				order = Math.max(0, collection.length - 1);
			}

			model.set('order', order);
		},

		checkMax: function(model, collection) {
			var max = this.model.get('max');
			var hideActions = max > collection.length;

			if (max <= 0) {
				return false;
			}

			this.$actions.toggle(hideActions);
		},

		checkMin: function(model, collection) {
			var min = this.model.get('min');
			var addRow = min > 0 && min > collection.length;

			if (!addRow) {
				return false;
			}

			if (this.multipleGroups) {
				this.$groupsList.find('a:first').trigger('click');
			} else {
				this.$actions.find('a.button').trigger('click');
			}
		},

		setGroupIndex: function(model, collection) {
			var index = this.model.get('index');

			model.set('index', index);

			this.model.set('index', index + 1);
		},

		toggleIntroRow: function() {
			this.$introRow.toggle(this.groupsCollection.length === 0);
		},

		sortGroups: function() {
			this.groupsCollection.sort(); // also triggers the "sort" event on the collection
		},

		reorderGroups: function(collection) {
			_.each(this.groupsCollection.models, function(model, i) {
				model.set('order', i)
			});
		},

		setDOMVariables: function() {
			this.$actions = this.$('.carbon-actions');
			this.$introRow = this.$('.carbon-empty-row');
			this.$groupsList = this.$actions.find('ul');
			this.$groupsHolder = this.$('.carbon-groups-holder');
		},

		setGroups: function() {
			var _this = this;
			var groups = this.model.get('value');

			_.each(groups, function(group) {
				_this.groupsCollection.add(group, {
					sort: false
				});
			});
		},

		sortable: function() {
			var _this = this;

			this.$groupsHolder.sortable({
				items : '> .carbon-group-row',
				handle: '.carbon-drag-handle',
				placeholder: 'carbon-group-row ui-placeholder-highlight',
				start: function(event, ui) {
					_this.$groupsHolder.addClass('carbon-container-shrank');

					ui.item.groupID = ui.item.data('group-id');
					ui.item.groupView = carbon.views[ui.item.groupID];
					ui.item.groupModel = ui.item.groupView.model;
					ui.item.groupsCollection = ui.item.groupModel.collection;
					ui.item.groupCollapsedState = ui.item.groupModel.get('collapsed');

					ui.item.groupModel.set('collapsed', true);
					ui.item.groupView.trigger('sortable', event);

					$(this).sortable('refresh');
				},
				stop: function(event, ui) {
					_this.$groupsHolder.removeClass('carbon-container-shrank');

					ui.item.groupModel.set('collapsed', ui.item.groupCollapsedState);
					ui.item.groupView.trigger('sortable', event);
				},
				update: function(event, ui) {
					var newOrder = ui.item.index();
					var oldOrder = ui.item.groupModel.get('order');

					ui.item.groupModel.set('order', newOrder);

					ui.item.groupsCollection
						.moveTo(oldOrder, newOrder)
						.sort();

					ui.item.groupView.trigger('sortable', event);
				}
			});
		},

		buttonAction: function(event) {
			var $element = $(event.target);
			var groupName = $element.data('group');

			if (groupName) {
				this.addNewGroup(groupName);
			} else if (this.multipleGroups) {
				this.$groupsList.toggle();
			} else {
				this.$actions.find('a.button').trigger('click');
			}

			event.preventDefault();
		},

		hideGroupsListListener: function() {
			var _this = this;
			var $actionButton = this.$actions.find('a.button');
			var $introButton = this.$introRow.find('a');

			carbon.views.main.$body.on('click', function(event) {
				if (event.target !== $actionButton[0] && event.target !== $introButton[0]) {
					_this.$groupsList.hide();
				}
			});
		},

		addNewGroup: function(group) {
			if (_.isString(group)) {
				group = this.model.getGroupByName(group);
			}

			this.groupsCollection.add(group, {
				sort: false
			});
		},

		setGroupID: function(model) {
			var index = model.get('index');
			var complexID = this.model.get('id');
			var id = complexID + '-' + index;

			model.set('id', id);
		},

		renderGroup: function(model) {
			var _this = this;
			var id = model.get('id');

			carbon.views[id] = new carbon.fields.View.Complex.Group({
				el: this.$groupsHolder,
				model: model
			});

			carbon.views[id].on('layoutUpdated', function() {
				_this.trigger('layoutUpdated');
			});

			carbon.views[id].render(this.model);

			return this;
		}
	});

	/*--------------------------------------------------------------------------
	 * COMPLEX GROUP
	 *------------------------------------------------------------------------*/

	// Group MODEL
	carbon.fields.Model.Complex.Group = Backbone.Model.extend({
		defaults: {
			'order': null,
			'index': null,
			'collapsed': false
		},

		initialize: function() {
			var fields = this.get('fields');

			_.each(fields, function(field) {
				if (field.hasOwnProperty('old_id') && field.hasOwnProperty('old_name')) {
					field.id = field.old_id;
					field.name = field.old_name;

					delete field.old_id;
					delete field.old_name;
				}
			});

			this.set('fields', fields);
		},

		validate: function(attrs, options) {
			return carbon.containers.Model.prototype.validate.apply(this, arguments);
		}
	});

	// Group VIEW
	carbon.fields.View.Complex.Group = Backbone.View.extend({
		events: {
			'click .carbon-group-actions:first a.carbon-btn-remove': 'removeGroup',
			'click .carbon-group-actions:first a.carbon-btn-collapse': 'collapseGroup',
			'click .carbon-group-actions:first a.carbon-btn-duplicate': 'duplicateGroup'
		},

		templateVariables: {},

		initialize: function() {
			this.on('group:rendered', this.setFields);

			// Updates the order number in the DOM
			this.listenTo(this.model, 'change:order', this.updateOrderNumber);

			// Triggers the "sortstart", "sortstop" or "sortupdate" event on each field/group view
			this.on('sortable', this.eventPropagator);

			// Propagate an event to all fields
			this.on('propagate', function(event) {
				carbon.containers.View.prototype.eventPropagator.apply(this, [this.fieldsCollection, event]);
			});

			this.listenTo(this.model, 'change:collapsed', this.toggleCollapse);

			/*
			 * Fields Collection
			 */
			this.fieldsCollection = new carbon.fields.Collection(this.model.get('fields'));

			this.listenTo(this.fieldsCollection, 'add', this.updateFieldNameID);
			this.listenTo(this.fieldsCollection, 'add', this.renderField);
			this.listenTo(this.fieldsCollection, 'change', this.sync);

			// Listen for fields that want to multiply and create new groups with them
			this.listenTo(this.fieldsCollection, 'change:multiply', this.multiplier);
		},

		multiplier: function(model) {
			var fieldData = model.get('multiply');
			var fieldID = model.get('old_id');
			var groupsCollection = this.model.collection;
			var groupName = this.model.get('name');
			var group = $.extend(true, {}, this.complexModel.getGroupByName(groupName));

			// loop the group fields and set the new model data
			_.each(group.fields, function(field) {
				// check if this is the right field
				if (fieldID !== field.id) {
					return; // continue
				}

				// update the field data
				_.each(_.keys(fieldData), function(key) {
					field[key] = fieldData[key];
				});
			});

			// Add the new group with the proper field data
			groupsCollection.add(group, {
				sort: false
			});
		},

		toggleCollapse: function(model) {
			var collapsed = model.get('collapsed');

			this.$el.toggleClass('collapsed', collapsed);
		},

		eventPropagator: function(event) {
			_.each(this.fieldsCollection.models, function(model) {
				var view = carbon.views[model.get('id')];

				if (view.hasOwnProperty('groupsCollection')) {
					_.each(view.groupsCollection.models, function(groupModel) {
						var groupView = carbon.views[groupModel.get('id')];

						groupView.trigger('sortable', event);
					});
				}

				// Trigger the event on the field view
				view.trigger(event.type);
			});
		},

		sync: function() {
			this.model.set('fields', this.fieldsCollection.toJSON());
		},

		updateFieldNameID: function(model, collection) {
			var id = model.get('id');
			var name = model.get('name');

			var index = this.model.get('index');
			var complexName = this.complexModel.get('name');
			var complexID = this.complexModel.get('id');

			var newID = complexID + '-' + id + '-' + index;
			var newName = complexName + '[' + index + '][' + name + ']';

			// store the original ID/Name for the field, useful for reinitialization
			model.set('old_id', id);
			model.set('old_name', name);

			// set the new ID/Name for the field
			model.set('id', newID);
			model.set('name', newName);
		},

		updateOrderNumber: function(model) {
			var groupOrder = model.get('order');

			this.$('> .carbon-drag-handle .group-number').text(groupOrder + 1);
		},

		render: function(complexModel) {
			this.complexModel = complexModel;

			var groupOrder = this.model.get('order');
			var template = carbon.template('Complex-Group');

			_.extend(this.templateVariables, this.model.attributes, {
				complex_id: this.complexModel.get('id'),
				complex_name: this.complexModel.get('name'),
				layout: this.complexModel.get('layout'),
				fields: this.fieldsCollection.toJSON()
			});

			this.trigger('group:beforeRender');

			var groupHTML = template(this.templateVariables);

			// At this moment this.$el points to the groups holder ( .carbon-groups-holder )
			var $holder = this.$el;
			var $children = $holder.children();

			// We need to separate the group itself from the groups holder,
			// this will also rebind all events from the holder to the group.
			this.setElement(groupHTML);

			this.$el.hide();

			// Append the group in the correct position
			if ($children.length) {
				$children.eq(groupOrder - 1).after(this.$el);
			} else {
				$holder.append(this.$el);
			}

			// Show the group
			this.$el.fadeIn();

			this.trigger('group:rendered');
		},

		removeGroup: function(event) {
			var _this = this;

			// Completely unbind the view
			this.undelegateEvents();
			this.$el.removeData().unbind(); 

			this.$el.addClass('removed').fadeOut(function() {
				// Remove view from the DOM
				_this.remove();

				// Remove the group from the groupsCollection, this will trigger the "remove" event on the collection
				_this.model.collection.remove(_this.model);
			});

			event.preventDefault();
		},

		collapseGroup: function(event) {
			var collapsed = this.model.get('collapsed');

			this.model.set('collapsed', !collapsed);

			event.preventDefault();
		},

		syncBeforeDuplicate: function(event) {
			var $focused = $(':focus');

			if ($focused.length) {
				$focused.trigger('change');
			}
		},

		duplicateGroup: function(event) {
			this.syncBeforeDuplicate(event);

			var groupsCollection = this.model.collection;

			var attributes = $.extend(true, {}, this.model.attributes);
			attributes.id = null;
			attributes.collapsed = false;

			if (attributes.hasOwnProperty('fields')) {
				attributes.fields = this.fieldsCollection.toJSON();
			}

			var newModel = new this.model.constructor(attributes);

			groupsCollection.add(newModel);

			event.preventDefault();
		},

		setFields: function() {
			this.fieldsCollection.reset();
			this.fieldsCollection.set(this.model.get('fields')); // This will emit the "add" event on the collection
		},

		setHelperClasses: function(model) {
			var type = model.get('type');

			// Add "odd", "even" classes on complex fields
			if (type === 'Complex') {
				var complexClasses = this.complexModel.get('classes');

				var isEven = $.inArray('even', complexClasses) !== -1;
				var isOdd = $.inArray('odd', complexClasses) !== -1;

				if (!isEven && !isOdd) {
					this.complexModel.addClass('odd');
					isOdd = true;
				}

				if (isEven) {
					model.addClass('odd');
				} else if (isOdd) {
					model.addClass('even');
				}
			}
		},

		renderField: function(model) {
			carbon.containers.View.prototype.renderField.apply(this, arguments);

			this.setHelperClasses(model);
		}
	});

	// Complex Group COLLECTION
	carbon.fields.Collection.Group = Backbone.Collection.extend({
		model: carbon.fields.Model.Complex.Group,

		moveTo: function(oldIndex, newIndex) {
			var spliced = this.models.splice(oldIndex, 1);
			this.models.splice(newIndex, 0, spliced[0]);
			this.trigger('move', [oldIndex,newIndex]);

			return this;
		}
	});

}(jQuery));