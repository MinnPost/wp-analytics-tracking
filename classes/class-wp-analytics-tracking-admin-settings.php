<?php

/**
 * Include/require file to make settings api easier to setup
 *
 * @file
 */

// this file should not be accessed directly
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class WP_Analytics_Tracking_Admin_Settings {

	public function __construct() {}

	/**
	* Default display for <input> fields
	*
	* @param array $args
	* @return string $field
	*/
	public function display_input_field( $args ) {

		$field = '';

		$type    = $args['type'];
		$id      = $args['label_for'];
		$name    = $args['name'];
		$desc    = $args['desc'];
		$checked = '';

		$class = 'regular-text';

		if ( 'checkbox' === $type ) {
			$class = 'checkbox';
		}

		if ( isset( $args['constant'] ) && defined( $args['constant'] ) ) {
			echo sprintf( '<p><code>%1$s</code></p>',
				esc_html__( 'Defined in wp-config.php', 'wp-analytics-tracking-generator' )
			);
		} else {

			$value = esc_attr( get_option( $id, '' ) );
			if ( 'checkbox' === $type ) {
				if ( '1' === $value ) {
					$checked = 'checked ';
				}
				$value = 1;
			}
			if ( '' === $value && isset( $args['default'] ) && '' !== $args['default'] ) {
				$value = $args['default'];
			}

			$field .= sprintf( '<input type="%1$s" value="%2$s" name="%3$s" id="%4$s" class="%5$s"%6$s>',
				esc_attr( $type ),
				esc_attr( $value ),
				esc_attr( $name ),
				esc_attr( $id ),
				sanitize_html_class( $class . esc_html( ' code' ) ),
				esc_html( $checked )
			);
			if ( '' !== $desc ) {
				$field .= sprintf( '<p class="description">%1$s</p>',
					esc_html( $desc )
				);
			}

			echo $field;
		}
	}

	/**
	* Display for multiple checkboxes
	* Above method can handle a single checkbox as it is
	*
	* @param array $args
	* @return string $field
	*/
	public function display_checkboxes( $args ) {

		$field = '';

		$type = 'checkbox';
		if ( 'radio' === $args['type'] ) {
			$type = 'radio';
		}

		$name       = $args['name'];
		$group_desc = $args['desc'];
		$options    = get_option( $name, array() );

		foreach ( $args['items'] as $key => $value ) {
			$text = $value['text'];
			$id   = $value['id'];
			$desc = $value['desc'];
			if ( isset( $value['value'] ) ) {
				$item_value = $value['value'];
			} else {
				$item_value = $key;
			}
			$checked = '';
			if ( is_array( $options ) && in_array( (string) $item_value, $options, true ) ) {
				$checked = 'checked';
			} elseif ( is_array( $options ) && empty( $options ) ) {
				if ( isset( $value['default'] ) && true === $value['default'] ) {
					$checked = 'checked';
				}
			}

			$input_name = $name;

			$field .= sprintf( '<div class="checkbox"><label><input type="%1$s" value="%2$s" name="%3$s[]" id="%4$s"%5$s>%6$s</label></div>',
				esc_attr( $type ),
				esc_attr( $item_value ),
				esc_attr( $input_name ),
				esc_attr( $id ),
				esc_html( $checked ),
				esc_html( $text )
			);
			if ( '' !== $desc ) {
				$field .= sprintf( '<p class="description">%1$s</p>',
					esc_html( $desc )
				);
			}
		}

		if ( '' !== $group_desc ) {
			$field .= sprintf( '<p class="description">%1$s</p>',
				esc_html( $group_desc )
			);
		}

		echo $field;

	}

	/**
	* Display for a dropdown/select
	*
	* @param array $args
	* @return string $field
	*/
	public function display_select( $args ) {

		$field = '';

		$type = $args['type'];
		$id   = $args['label_for'];
		$name = $args['name'];
		$desc = $args['desc'];

		$current_value = get_option( $name, '' );

		$field .= sprintf( '<div class="select"><select id="%1$s" name="%2$s"><option value="">- Select one -</option>',
			esc_attr( $id ),
			esc_attr( $name )
		);

		foreach ( $args['items'] as $key => $value ) {
			$text = $value['text'];

			if ( isset( $value['value'] ) ) {
				$item_value = $value['value'];
			} else {
				$item_value = $key;
			}

			$selected = '';

			if ( isset( $current_value ) && $item_value === $current_value ) {
				$selected = ' selected';
			} elseif ( '' === $current_value ) {
				if ( isset( $value['default'] ) && true === $value['default'] ) {
					$selected = ' selected';
				}
			}

			$field .= sprintf( '<option value="%1$s"%2$s>%3$s</option>',
				esc_attr( $item_value ),
				esc_attr( $selected ),
				esc_html( $text )
			);

		}
		$field .= '</select>';
		if ( '' !== $desc ) {
			$field .= sprintf( '<p class="description">%1$s</p>',
				esc_html( $desc )
			);
		}
		$field .= '</div>';

		echo $field;
	}

	/**
	* Display for a textarea
	*
	* @param array $args
	*/
	public function display_textarea( $args ) {
		$id    = $args['label_for'];
		$name  = $args['name'];
		$desc  = $args['desc'];
		$rows  = $args['rows'];
		$cols  = $args['cols'];
		$class = 'regular-text';

		$value = esc_attr( get_option( $id, '' ) );
		if ( '' === $value && isset( $args['default'] ) && '' !== $args['default'] ) {
			$value = $args['default'];
		}

		if ( '' !== $rows ) {
			$rows_attr = ' rows="' . esc_attr( $rows ) . '"';
		} else {
			$rows_attr = '';
		}

		if ( '' !== $cols ) {
			$cols_attr = ' cols="' . esc_attr( $cols ) . '"';
		} else {
			$cols_attr = '';
		}

		echo sprintf( '<textarea name="%1$s" id="%2$s" class="%3$s"%4$s%5$s>%6$s</textarea>',
			esc_attr( $name ),
			esc_attr( $id ),
			sanitize_html_class( $class . esc_html( ' code' ) ),
			$rows_attr,
			$cols_attr,
			esc_attr( $value )
		);
		if ( '' !== $desc ) {
			echo sprintf( '<p class="description">%1$s</p>',
				esc_html( $desc )
			);
		}
	}

	/**
	* Default display for <a href> links
	*
	* @param array $args
	* @return string $field
	*/
	public function display_link( $args ) {

		$field = '';

		$label = $args['label'];
		$desc  = $args['desc'];
		$url   = $args['url'];
		if ( isset( $args['link_class'] ) ) {
			$field .= sprintf( '<p><a class="%1$s" href="%2$s">%3$s</a></p>',
				esc_attr( $args['link_class'] ),
				esc_url( $url ),
				esc_html( $label )
			);
		} else {
			$field .= sprintf( '<p><a href="%1$s">%2$s</a></p>',
				esc_url( $url ),
				esc_html( $label )
			);
		}

		if ( '' !== $desc ) {
			$field .= sprintf( '<p class="description">%1$s</p>',
				esc_html( $desc )
			);
		}

		echo $field;
	}

}
